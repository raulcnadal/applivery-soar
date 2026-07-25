import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, Copy, Refresh as RefreshCw, PlugCircle as Webhook, DangerTriangle as AlertTriangle, CheckCircle as Check } from '@solar-icons/react';

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

function Field({ label, theme, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
    </div>
  );
}

function TriggerForm({ initial, workflows, theme, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [workflowId, setWorkflowId] = useState(initial?.workflowId || workflows[0]?.id || '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [deviceLookupField, setDeviceLookupField] = useState(initial?.deviceLookupField || '');
  const [openCase, setOpenCase] = useState(initial?.openCase ?? false);
  const [caseSeverity, setCaseSeverity] = useState(initial?.caseSeverity || 'medium');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !workflowId) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(), description: description.trim(), workflowId, enabled,
        deviceLookupField: deviceLookupField.trim() || null, openCase, caseSeverity,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 rounded-xl mb-3 space-y-3" style={{ border: `1px solid ${PRIMARY_BLUE}40`, backgroundColor: theme.bg }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" theme={theme}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CrowdStrike containment"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }} />
        </Field>
        <Field label="Workflow to run" theme={theme}>
          <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}>
            {workflows.length === 0 && <option value="">No workflows yet</option>}
            {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description (optional)" theme={theme}>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What sends this and why"
          className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }} />
      </Field>
      <Field label="Device lookup field (optional)" theme={theme}>
        <input value={deviceLookupField} onChange={(e) => setDeviceLookupField(e.target.value)} placeholder="e.g. serialNumber, hostname, email"
          className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }} />
        <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>
          The key in the inbound JSON body whose value gets matched against each device's serial number, id, or MDM user email. Leave blank if the workflow doesn't need a target device (notification/HTTP steps only).
        </p>
      </Field>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
        <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
          <input type="checkbox" checked={openCase} onChange={(e) => setOpenCase(e.target.checked)} /> Open a Case on fire
        </label>
        {openCase && (
          <select value={caseSeverity} onChange={(e) => setCaseSeverity(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim() || !workflowId} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create trigger')}
        </button>
      </div>
    </form>
  );
}

export default function TriggersSettings({ orgSlug, theme }) {
  const [triggers, setTriggers] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = edit
  const [copiedId, setCopiedId] = useState(null);

  const headers = { 'X-Workspace-Slug': orgSlug };

  const fetchAll = useCallback(async () => {
    if (!orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const [triggersRes, workflowsRes] = await Promise.all([
        axios.get('/api/triggers', { headers }),
        axios.get('/api/workflows', { headers }),
      ]);
      setTriggers(triggersRes.data?.items || []);
      setWorkflows(workflowsRes.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load inbound webhook triggers.');
    } finally {
      setIsLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSave(data) {
    if (editing && editing.id) {
      await axios.put(`/api/triggers/${editing.id}`, data, { headers });
    } else {
      await axios.post('/api/triggers', data, { headers });
    }
    setEditing(undefined);
    fetchAll();
  }

  async function handleDelete(trigger) {
    if (!window.confirm(`Delete trigger "${trigger.name}"? Its webhook URL stops working immediately.`)) return;
    await axios.delete(`/api/triggers/${trigger.id}`, { headers });
    fetchAll();
  }

  async function handleRotate(trigger) {
    if (!window.confirm(`Rotate the secret for "${trigger.name}"? Any system already configured with the current URL will need to be updated.`)) return;
    await axios.post(`/api/triggers/${trigger.id}/rotate-secret`, {}, { headers });
    fetchAll();
  }

  function webhookUrl(trigger) {
    return `${window.location.origin}/api/triggers/fire/${trigger.id}/${trigger.secret}`;
  }

  function handleCopy(trigger) {
    navigator.clipboard?.writeText(webhookUrl(trigger));
    setCopiedId(trigger.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Lets an external system (EDR, firewall, SIEM, IDS — anything that can POST JSON to a URL) fire a specific Workflow directly, no Compliance Policy required. Each trigger gets its own self-contained URL — id and secret both live in the path, the same pattern Slack/Teams/PagerDuty use for their own incoming webhooks — so pasting it into any of those tools is enough.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {editing !== undefined && (
        <TriggerForm
          initial={editing}
          workflows={workflows}
          theme={theme}
          onCancel={() => setEditing(undefined)}
          onSave={handleSave}
        />
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : triggers.length === 0 && editing === undefined ? (
        <p className="text-xs mb-3" style={{ color: theme.textMuted }}>No inbound webhook triggers configured yet.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {triggers.map(t => {
            const workflow = workflows.find(w => w.id === t.workflowId);
            return (
              <div key={t.id} className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex items-center gap-2">
                    <Webhook size={14} style={{ color: t.enabled ? PRIMARY_BLUE : theme.textMuted }} className="shrink-0" />
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{t.name}</p>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: t.enabled ? `${SUCCESS}15` : `${theme.textMuted}15`, color: t.enabled ? SUCCESS : theme.textMuted }}>
                      {t.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {t.openCase && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>Opens Case</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleRotate(t)} title="Rotate secret" className="p-1.5 rounded-lg" style={{ color: theme.textMuted }}><RefreshCw size={13} /></button>
                    <button onClick={() => setEditing(t)} title="Edit" className="p-1.5 rounded-lg" style={{ color: theme.textMuted }}><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(t)} title="Delete" className="p-1.5 rounded-lg" style={{ color: DANGER }}><Trash2 size={13} /></button>
                  </div>
                </div>
                <p className="text-xs mb-2" style={{ color: theme.textMuted }}>
                  Runs "{workflow?.name || 'Unknown workflow'}"{t.deviceLookupField ? ` · matches device by "${t.deviceLookupField}"` : ' · no device target'}
                  {' · '}{t.fireCount || 0} fire{(t.fireCount || 0) === 1 ? '' : 's'}{t.lastFiredAt ? ` · last ${timeAgo(t.lastFiredAt)}` : ''}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2 py-1.5 rounded-lg text-[10px] truncate" style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}`, color: theme.text }}>
                    {webhookUrl(t)}
                  </code>
                  <button onClick={() => handleCopy(t)} className="p-1.5 rounded-lg shrink-0" style={{ border: `1px solid ${theme.border}`, color: copiedId === t.id ? SUCCESS : theme.text }}>
                    {copiedId === t.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing === undefined && (
        <button
          onClick={() => setEditing(null)}
          disabled={workflows.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50"
        >
          <Plus size={14} /> New Trigger
        </button>
      )}
      {workflows.length === 0 && (
        <p className="text-[10px] mt-2" style={{ color: theme.textMuted }}>Create a Workflow first — triggers need one to run.</p>
      )}
    </div>
  );
}
