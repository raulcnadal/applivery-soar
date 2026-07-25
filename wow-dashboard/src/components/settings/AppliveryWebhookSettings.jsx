import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Copy, Refresh as RefreshCw, DangerTriangle as AlertTriangle, CheckCircle as Check, PlugCircle as Webhook, ArrowRightUp as ExternalLink } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';

function timeAgo(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function outcomeColor(outcome) {
  if (!outcome) return '#6B7280';
  if (outcome.includes('blocked') || outcome.includes('missing') || outcome.includes('unavailable') || outcome.includes('no_automation_credential')) return WARNING;
  if (outcome.includes('fired') || outcome.includes('case_opened')) return SUCCESS;
  return '#6B7280';
}

function RuleRow({ rule, workflows, mdmActionsByKey, theme, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const selectedWorkflow = workflows.find(w => w.id === rule.workflowId);
  const isDestructive = !!selectedWorkflow && (selectedWorkflow.steps || []).some(
    s => s.type === 'mdm_action' && mdmActionsByKey[s.config?.action]?.destructive
  );

  function set(patch) {
    onChange({ ...rule, ...patch });
  }

  return (
    <div className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span className="text-sm font-semibold truncate" style={{ color: theme.text }}>{rule.label || rule.actionKey}</span>
          <code className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: theme.bg, color: theme.textMuted }}>{rule.actionKey}</code>
        </label>
        <button type="button" onClick={() => setExpanded(e => !e)} className="text-[10px] font-semibold shrink-0" style={{ color: PRIMARY_BLUE }}>
          {expanded ? 'Hide' : 'Configure'}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 pl-6">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
              <input type="checkbox" checked={rule.openCase} onChange={(e) => set({ openCase: e.target.checked })} /> Open a Case
            </label>
            {rule.openCase && (
              <select value={rule.caseSeverity} onChange={(e) => set({ caseSeverity: e.target.value })}
                className="px-2 py-1 rounded-lg text-xs outline-none" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            )}
            <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
              <input type="checkbox" checked={rule.runWorkflow} onChange={(e) => set({ runWorkflow: e.target.checked })} /> Run a Workflow
            </label>
            {rule.runWorkflow && (
              <select value={rule.workflowId || ''} onChange={(e) => {
                  // See PolicyBuilder.jsx's matching workflow-select handler
                  // — defaults (doesn't force) this rule's own acknowledgment
                  // checkbox to the newly-picked workflow's author-declared
                  // default each time the selection changes.
                  const picked = workflows.find(w => w.id === e.target.value);
                  set({ workflowId: e.target.value, autoRunDestructiveAck: !!picked?.allowUnattendedDestructive });
                }}
                className="px-2 py-1 rounded-lg text-xs outline-none" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}>
                <option value="">Select workflow…</option>
                {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            )}
          </div>
          {rule.runWorkflow && isDestructive && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
              <AlertTriangle size={14} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-semibold" style={{ color: DANGER }}>"{selectedWorkflow?.name}" includes a destructive action</p>
                <p className="text-[11px] mt-0.5 mb-2 leading-relaxed" style={{ color: theme.textMuted }}>
                  Enabling this rule means it fires unattended the moment Applivery sends this event, with no human review.
                </p>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: theme.text }}>
                  <input type="checkbox" checked={rule.autoRunDestructiveAck} onChange={(e) => set({ autoRunDestructiveAck: e.target.checked })} />
                  I understand and want this rule to fire it unattended
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AppliveryWebhookSettings({ apiToken, orgSlug, theme }) {
  const [config, setConfig] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [mdmActions, setMdmActions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dirty, setDirty] = useState(false);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchAll = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const [cfgRes, wfRes, actRes] = await Promise.all([
        axios.get('/api/applivery-webhook', { headers }),
        axios.get('/api/workflows', { headers }),
        axios.get('/api/mdm-actions', { headers }),
      ]);
      setConfig(cfgRes.data);
      setWorkflows(wfRes.data?.items || []);
      setMdmActions(actRes.data?.items || []);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load Applivery event webhook settings.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const mdmActionsByKey = Object.fromEntries(mdmActions.map(a => [a.key, a]));

  function updateRule(updated) {
    setConfig(c => ({ ...c, rules: c.rules.map(r => r.actionKey === updated.actionKey ? updated : r) }));
    setDirty(true);
  }

  function toggleMaster(enabled) {
    setConfig(c => ({ ...c, enabled }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await axios.put('/api/applivery-webhook', { enabled: config.enabled, rules: config.rules }, { headers });
      setConfig(res.data);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRotate() {
    if (!window.confirm("Rotate the webhook URL? Update it in Applivery's own Integrations settings afterward, or events stop arriving.")) return;
    const res = await axios.post('/api/applivery-webhook/rotate-secret', {}, { headers });
    setConfig(res.data);
  }

  function webhookUrl() {
    return config?.secret ? `${window.location.origin}/api/applivery-webhook/receive/${config.secret}` : '';
  }

  function handleCopy() {
    navigator.clipboard?.writeText(webhookUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isLoading || !config) {
    return <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>;
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Applivery has its own native webhook system, configured entirely inside Applivery's Workspace or App &gt; Integrations settings — paste the URL below there and pick the events to send. Applivery's event catalog is still small today (device enrollment, MDM user changes, builds, bug/feedback reports, certificate expiry) but is expected to grow — new event types show up below automatically the first time Applivery ever sends one, nothing to configure in advance.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="p-4 rounded-xl mb-4 space-y-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.text }}>
            <input type="checkbox" checked={config.enabled} onChange={(e) => toggleMaster(e.target.checked)} /> Webhook receiver enabled
          </label>
          <button onClick={handleRotate} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
            <RefreshCw size={12} /> Rotate URL
          </button>
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Webhook URL — paste into Applivery's Integrations settings</label>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-nowrap" style={{ backgroundColor: theme.card, color: theme.text, border: `1px solid ${theme.border}` }}>
              {webhookUrl()}
            </code>
            <button onClick={handleCopy} className="p-2 rounded-lg border shrink-0" style={{ borderColor: theme.border, color: copied ? SUCCESS : theme.text }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>
        <a href="https://www.applivery.com/docs/platform/integrations/webhooks/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: PRIMARY_BLUE }}>
          How to add a webhook in Applivery <ExternalLink size={11} />
        </a>
        {config.lastReceivedAt && (
          <p className="text-[10px]" style={{ color: theme.textMuted }}>
            {config.receivedCount || 0} event{(config.receivedCount || 0) === 1 ? '' : 's'} received · last {timeAgo(config.lastReceivedAt)}
          </p>
        )}
      </div>

      <h4 className="text-xs font-semibold mb-2" style={{ color: theme.text }}>Event rules</h4>
      <div className="space-y-2 mb-4">
        {(config.rules || []).map(rule => (
          <RuleRow key={rule.actionKey} rule={rule} workflows={workflows} mdmActionsByKey={mdmActionsByKey} theme={theme} onChange={updateRule} />
        ))}
      </div>

      {dirty && (
        <div className="flex justify-end gap-2 mb-6">
          <button onClick={fetchAll} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Discard</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {(config.recentEvents || []).length > 0 && (
        <>
          <h4 className="text-xs font-semibold mb-2" style={{ color: theme.text }}>Recent events</h4>
          <div className="space-y-1.5">
            {config.recentEvents.slice(0, 15).map(ev => (
              <div key={ev.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="min-w-0 flex items-center gap-2">
                  <Webhook size={12} style={{ color: theme.textMuted }} className="shrink-0" />
                  <span className="font-medium truncate" style={{ color: theme.text }}>{ev.actionKey}</span>
                  {ev.deviceName && <span className="truncate" style={{ color: theme.textMuted }}>· {ev.deviceName}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${outcomeColor(ev.outcome)}15`, color: outcomeColor(ev.outcome) }}>
                    {(ev.outcome || '').replace(/_/g, ' ')}
                  </span>
                  <span style={{ color: theme.textMuted }}>{timeAgo(ev.receivedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
