import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, DangerTriangle as AlertTriangle,
  CheckCircle as Check, ChatRound as MessageCircle, PlugCircle as Webhook, TestTube,
} from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const SUCCESS = '#22C55E';

const TYPE_META = {
  slack: { label: 'Slack', hint: 'Incoming Webhook URL (Slack app → Incoming Webhooks → Add New Webhook).' },
  teams: { label: 'Microsoft Teams', hint: 'A Workflows app webhook URL — Teams retired the old "Incoming Webhook" connector in 2026. In Teams: channel → Workflows → "Post to a channel when a webhook request is received".' },
  discord: { label: 'Discord', hint: 'Channel → Edit Channel → Integrations → Webhooks → New Webhook, copy its URL.' },
  jira: { label: 'Jira', hint: 'Creates a new issue on open. When the Case closes, automatically fires whichever transition on the issue looks like "Done/Resolved/Closed" — best-effort based on your project\'s workflow.' },
  servicenow: { label: 'ServiceNow', hint: 'Creates a new record on open (default table: incident). When the Case closes, automatically resolves the linked record (state = Resolved).' },
  generic_webhook: { label: 'Generic Webhook', hint: 'POSTs {"event": ..., "case": {...}} as JSON — for anything without a dedicated type above.' },
  pagerduty: { label: 'PagerDuty', hint: 'Events API v2 integration key, from a PagerDuty service → Integrations → "Events API V2". Pages on open, auto-resolves the same incident when the Case closes.' },
  opsgenie: { label: 'Opsgenie', hint: 'A Genie Key from Settings → API key management. Pages on open, auto-closes the same alert when the Case closes.' },
};

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

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

function Field({ label, theme, children, hint }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
      {hint && <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>{hint}</p>}
    </div>
  );
}

function inputCls(theme) {
  return { border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text };
}

function IntegrationForm({ initial, theme, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'slack');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [notifyOnOpen, setNotifyOnOpen] = useState(initial?.notifyOnOpen ?? true);
  const [notifyOnClose, setNotifyOnClose] = useState(initial?.notifyOnClose ?? false);
  const [autoCloseCaseOnRemoteResolve, setAutoCloseCaseOnRemoteResolve] = useState(initial?.autoCloseCaseOnRemoteResolve ?? false);
  const [notifyOnSystemHealth, setNotifyOnSystemHealth] = useState(initial?.notifyOnSystemHealth ?? false);
  const [minSeverity, setMinSeverity] = useState(initial?.minSeverity || 'low');
  const [config, setConfig] = useState(initial?.config || {});
  const [saving, setSaving] = useState(false);

  function setCfg(key, value) {
    setConfig(c => ({ ...c, [key]: value }));
  }
  function handleTypeChange(t) {
    setType(t);
    if (!initial) setConfig({});
  }

  const isChatType = type === 'slack' || type === 'teams' || type === 'discord';
  const isTicketingType = type === 'jira' || type === 'servicenow';
  const isPagingType = type === 'pagerduty' || type === 'opsgenie';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), type, enabled, notifyOnOpen, notifyOnClose, autoCloseCaseOnRemoteResolve, notifyOnSystemHealth, minSeverity, config });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 rounded-xl mb-3 space-y-3" style={{ border: `1px solid ${PRIMARY_BLUE}40`, backgroundColor: theme.bg }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" theme={theme}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. #security-alerts"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
        <Field label="Type" theme={theme}>
          <select value={type} onChange={(e) => handleTypeChange(e.target.value)} disabled={!!initial}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60" style={inputCls(theme)}>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-[10px]" style={{ color: theme.textMuted }}>{TYPE_META[type].hint}</p>

      {isChatType && (
        <Field label="Webhook URL" theme={theme}>
          <input value={config.webhookUrl || ''} onChange={(e) => setCfg('webhookUrl', e.target.value)} placeholder="https://..."
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
      )}

      {type === 'jira' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Site base URL" theme={theme}>
              <input value={config.baseUrl || ''} onChange={(e) => setCfg('baseUrl', e.target.value)} placeholder="https://yourorg.atlassian.net"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
            <Field label="Project key" theme={theme}>
              <input value={config.projectKey || ''} onChange={(e) => setCfg('projectKey', e.target.value)} placeholder="OPS"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account email" theme={theme}>
              <input value={config.email || ''} onChange={(e) => setCfg('email', e.target.value)} placeholder="you@company.com"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
            <Field label="API token" theme={theme}>
              <input type="password" value={config.apiToken || ''} onChange={(e) => setCfg('apiToken', e.target.value)} placeholder="id.atlassian.com/manage-profile/security/api-tokens"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
          </div>
          <Field label="Issue type" theme={theme}>
            <input value={config.issueType || 'Task'} onChange={(e) => setCfg('issueType', e.target.value)} placeholder="Task"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
          </Field>
        </>
      )}

      {type === 'servicenow' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Instance URL" theme={theme}>
              <input value={config.instanceUrl || ''} onChange={(e) => setCfg('instanceUrl', e.target.value)} placeholder="https://yourinstance.service-now.com"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
            <Field label="Table" theme={theme}>
              <input value={config.table || 'incident'} onChange={(e) => setCfg('table', e.target.value)} placeholder="incident"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username" theme={theme}>
              <input value={config.username || ''} onChange={(e) => setCfg('username', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
            <Field label="Password" theme={theme}>
              <input type="password" value={config.password || ''} onChange={(e) => setCfg('password', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
            </Field>
          </div>
        </>
      )}

      {type === 'generic_webhook' && (
        <Field label="URL" theme={theme}>
          <input value={config.url || ''} onChange={(e) => setCfg('url', e.target.value)} placeholder="https://..."
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
      )}

      {type === 'pagerduty' && (
        <Field label="Events API v2 routing key" theme={theme}>
          <input type="password" value={config.routingKey || ''} onChange={(e) => setCfg('routingKey', e.target.value)} placeholder="32-character integration key"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
      )}

      {type === 'opsgenie' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="API key (GenieKey)" theme={theme}>
            <input type="password" value={config.apiKey || ''} onChange={(e) => setCfg('apiKey', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
          </Field>
          <Field label="Region" theme={theme}>
            <select value={config.region || 'us'} onChange={(e) => setCfg('region', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)}>
              <option value="us">US</option>
              <option value="eu">EU</option>
            </select>
          </Field>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
        <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
          <input type="checkbox" checked={notifyOnOpen} onChange={(e) => setNotifyOnOpen(e.target.checked)} /> Notify when a Case opens
        </label>
        {isTicketingType ? (
          <>
            <span className="text-xs" style={{ color: theme.textMuted }} title="Jira/ServiceNow tickets auto-close/transition whenever a Case with a linked ticket is closed — not gated by this toggle.">
              Auto-syncs ticket status on close
            </span>
            <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }} title="When the linked ticket is found marked done on Jira/ServiceNow's own side, resolve the Case here to match. Off by default — the status is always recorded on the Case's timeline either way, this only controls whether it also flips the Case's status automatically.">
              <input type="checkbox" checked={autoCloseCaseOnRemoteResolve} onChange={(e) => setAutoCloseCaseOnRemoteResolve(e.target.checked)} /> Auto-resolve Case when ticket is done
            </label>
          </>
        ) : (
          <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
            <input type="checkbox" checked={notifyOnClose} onChange={(e) => setNotifyOnClose(e.target.checked)} /> Notify when a Case closes
          </label>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: theme.text }}>Min severity</span>
          <select value={minSeverity} onChange={(e) => setMinSeverity(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)}>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }} title="Also page/notify this destination when a background job (compliance scheduler, catalog refresher, SLA monitor, etc.) goes unhealthy — a different audience/urgency than a Case opening, so this is off by default even for paging destinations.">
          <input type="checkbox" checked={notifyOnSystemHealth} onChange={(e) => setNotifyOnSystemHealth(e.target.checked)} /> Notify on System Health issues
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create integration')}
        </button>
      </div>
    </form>
  );
}

export default function IntegrationsSettings({ orgSlug, theme, canManage = true }) {
  const [integrations, setIntegrations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = edit
  const [testState, setTestState] = useState({}); // { [id]: 'testing' | 'ok' | 'error message' }
  const [dryRunMap, setDryRunMap] = useState({}); // { [id]: boolean } — defaults to true for jira/servicenow so Test doesn't create a real ticket

  const headers = { 'X-Workspace-Slug': orgSlug };

  const fetchAll = useCallback(async () => {
    if (!orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/integrations', { headers });
      setIntegrations(res.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load integrations.');
    } finally {
      setIsLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSave(data) {
    if (editing && editing.id) {
      await axios.put(`/api/integrations/${editing.id}`, data, { headers });
    } else {
      await axios.post('/api/integrations', data, { headers });
    }
    setEditing(undefined);
    fetchAll();
  }

  async function handleDelete(integ) {
    if (!window.confirm(`Delete integration "${integ.name}"?`)) return;
    await axios.delete(`/api/integrations/${integ.id}`, { headers });
    fetchAll();
  }

  function isDryRun(integ) {
    return dryRunMap[integ.id] ?? (integ.type === 'jira' || integ.type === 'servicenow');
  }

  async function handleTest(integ) {
    const dryRun = isDryRun(integ);
    setTestState(s => ({ ...s, [integ.id]: 'testing' }));
    try {
      const res = await axios.post(`/api/integrations/${integ.id}/test`, {}, { headers, params: { dry_run: dryRun } });
      setTestState(s => ({ ...s, [integ.id]: res.data?.dryRun ? 'dry-run-ok' : 'ok' }));
    } catch (err) {
      setTestState(s => ({ ...s, [integ.id]: err.response?.data?.detail || 'Test failed' }));
    } finally {
      setTimeout(() => setTestState(s => ({ ...s, [integ.id]: undefined })), 4000);
      fetchAll();
    }
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Notifies Slack, Teams, or Discord and/or opens a ticket in Jira or ServiceNow whenever a Case opens (and, for chat destinations, optionally when one closes) — scoped to Cases rather than raw violations, so a device that's been broken for a week doesn't page anyone twice. Each integration has its own severity floor, so noisy low-severity cases can stay quiet while critical ones reach the team.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {editing !== undefined && (
        <IntegrationForm initial={editing} theme={theme} onCancel={() => setEditing(undefined)} onSave={handleSave} />
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : integrations.length === 0 && editing === undefined ? (
        <p className="text-xs mb-3" style={{ color: theme.textMuted }}>No ticketing or chat integrations configured yet.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {integrations.map(integ => {
            const meta = TYPE_META[integ.type] || { label: integ.type };
            const state = testState[integ.id];
            return (
              <div key={integ.id} className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    {integ.type === 'generic_webhook' || integ.type === 'pagerduty' || integ.type === 'opsgenie' ? <Webhook size={14} style={{ color: integ.enabled ? PRIMARY_BLUE : theme.textMuted }} className="shrink-0" /> : <MessageCircle size={14} style={{ color: integ.enabled ? PRIMARY_BLUE : theme.textMuted }} className="shrink-0" />}
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{integ.name}</p>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>{meta.label}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: integ.enabled ? `${SUCCESS}15` : `${theme.textMuted}15`, color: integ.enabled ? SUCCESS : theme.textMuted }}>
                      {integ.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1 text-[10px]" style={{ color: theme.textMuted }} title="When checked, Test only validates required config fields are present — no real ticket/message is sent.">
                      <input type="checkbox" checked={isDryRun(integ)} onChange={(e) => setDryRunMap(m => ({ ...m, [integ.id]: e.target.checked }))} /> Dry run
                    </label>
                    <button onClick={() => handleTest(integ)} disabled={state === 'testing' || !canManage} title={!canManage ? "Your role isn't permitted to test Integrations." : "Test this integration"} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: theme.textMuted }}><TestTube size={13} /></button>
                    <button onClick={() => setEditing(integ)} disabled={!canManage} title={!canManage ? "Your role isn't permitted to edit Integrations." : "Edit"} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: theme.textMuted }}><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(integ)} disabled={!canManage} title={!canManage ? "Your role isn't permitted to delete Integrations." : "Delete"} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: DANGER }}><Trash2 size={13} /></button>
                  </div>
                </div>
                <p className="text-xs mb-1" style={{ color: theme.textMuted }}>
                  Min severity: {integ.minSeverity} · {integ.notifyOnOpen ? 'Notifies on open' : 'Silent on open'}{integ.type !== 'jira' && integ.type !== 'servicenow' ? ` · ${integ.notifyOnClose ? 'Notifies on close' : 'Silent on close'}` : ` · ${integ.autoCloseCaseOnRemoteResolve ? 'Auto-resolves Case when ticket is done' : 'Ticket status synced, Case left open'}`}
                  {' · '}{integ.fireCount || 0} fire{(integ.fireCount || 0) === 1 ? '' : 's'}{integ.lastFiredAt ? ` · last ${timeAgo(integ.lastFiredAt)}` : ''}
                </p>
                {integ.lastError && (
                  <p className="text-[10px] mb-1" style={{ color: DANGER }}>Last error: {integ.lastError}</p>
                )}
                {state === 'testing' && <p className="text-[10px]" style={{ color: theme.textMuted }}>Testing…</p>}
                {state === 'dry-run-ok' && <p className="text-[10px] flex items-center gap-1" style={{ color: SUCCESS }}><Check size={11} /> Config looks valid — no real request was sent</p>}
                {state === 'ok' && <p className="text-[10px] flex items-center gap-1" style={{ color: SUCCESS }}><Check size={11} /> Test succeeded{(integ.type === 'jira' || integ.type === 'servicenow') ? ' — check the target system for a real test ticket' : ''}</p>}
                {state && state !== 'testing' && state !== 'ok' && state !== 'dry-run-ok' && <p className="text-[10px]" style={{ color: DANGER }}>{state}</p>}
              </div>
            );
          })}
        </div>
      )}

      {editing === undefined && canManage && (
        <button onClick={() => setEditing(null)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700">
          <Plus size={14} /> New Integration
        </button>
      )}
    </div>
  );
}
