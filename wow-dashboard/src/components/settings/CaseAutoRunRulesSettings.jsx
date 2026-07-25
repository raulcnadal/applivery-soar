import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, Target, DangerTriangle as AlertTriangle } from '@solar-icons/react';
import { useMitreCatalog, MitreTagPicker } from '../shared/MitreCatalog';

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

function Field({ label, theme, children, hint }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
      {hint && <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>{hint}</p>}
    </div>
  );
}

function RuleForm({ initial, workflows, mdmActions, apiToken, orgSlug, theme, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [minSeverity, setMinSeverity] = useState(initial?.minSeverity || 'high');
  const [mitreTechniques, setMitreTechniques] = useState(initial?.mitreTechniques || []);
  const [workflowId, setWorkflowId] = useState(initial?.workflowId || workflows[0]?.id || '');
  const [autoRunDestructiveAck, setAutoRunDestructiveAck] = useState(initial?.autoRunDestructiveAck ?? false);
  const [maxFiresPerHour, setMaxFiresPerHour] = useState(initial?.maxFiresPerHour ?? 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const mitreCatalog = useMitreCatalog(apiToken, orgSlug);

  const mdmActionsByKey = useMemo(() => Object.fromEntries(mdmActions.map(a => [a.key, a])), [mdmActions]);
  const selectedWorkflow = workflows.find(w => w.id === workflowId);
  const isDestructiveWorkflow = !!selectedWorkflow && (selectedWorkflow.steps || []).some(
    s => s.type === 'mdm_action' && mdmActionsByKey[s.config?.action]?.destructive
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !workflowId) return;
    if (enabled && isDestructiveWorkflow && !autoRunDestructiveAck) {
      setError(`"${selectedWorkflow?.name}" includes a destructive action — check the acknowledgment below to enable this rule with it.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        name: name.trim(), enabled, minSeverity, mitreTechniques, workflowId,
        autoRunDestructiveAck, maxFiresPerHour: Number(maxFiresPerHour) > 0 ? Number(maxFiresPerHour) : 10,
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save rule.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 rounded-xl mb-3 space-y-3" style={{ border: `1px solid ${PRIMARY_BLUE}40`, backgroundColor: theme.bg }}>
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" theme={theme}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Critical manual cases — quarantine"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }} />
        </Field>
        <Field label="Workflow to run" theme={theme}>
          <select value={workflowId} onChange={(e) => {
              // See PolicyBuilder.jsx's matching workflow-select handler —
              // defaults (doesn't force) this rule's own acknowledgment
              // checkbox to the newly-picked workflow's author-declared
              // default each time the selection changes.
              const picked = workflows.find(w => w.id === e.target.value);
              setWorkflowId(e.target.value);
              setAutoRunDestructiveAck(!!picked?.allowUnattendedDestructive);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}>
            {workflows.length === 0 && <option value="">No workflows yet</option>}
            {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Min severity" theme={theme} hint="Only manually-created cases at or above this severity match.">
          <select value={minSeverity} onChange={(e) => setMinSeverity(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </Field>
        <Field label="Max fires per hour" theme={theme} hint="Safety cap — a sudden burst of matching cases beyond this is queued for manual review instead of firing unattended.">
          <input type="number" min={1} max={1000} value={maxFiresPerHour} onChange={(e) => setMaxFiresPerHour(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }} />
        </Field>
      </div>

      <Field label="MITRE ATT&CK filter (optional)" theme={theme} hint="Leave empty to match any case regardless of tags — or require at least one of these techniques to be present.">
        <MitreTagPicker
          techniques={mitreCatalog.techniques}
          tactics={mitreCatalog.tactics}
          tacticColor={mitreCatalog.tacticColor}
          selected={mitreTechniques}
          onChange={setMitreTechniques}
          theme={theme}
          catalogMeta={mitreCatalog.catalogMeta}
          onRefreshCatalog={mitreCatalog.refreshCatalogNow}
        />
      </Field>

      {isDestructiveWorkflow && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
          <AlertTriangle size={15} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-semibold" style={{ color: DANGER }}>"{selectedWorkflow?.name}" includes a destructive action</p>
            <p className="text-[11px] mt-0.5 mb-2 leading-relaxed" style={{ color: theme.textMuted }}>
              Enabling this rule means it fires unattended against any matching manually-created case's device, with no human review.
            </p>
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: theme.text }}>
              <input type="checkbox" checked={autoRunDestructiveAck} onChange={(e) => setAutoRunDestructiveAck(e.target.checked)} />
              I understand and want this rule to fire it unattended
            </label>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim() || !workflowId} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create rule')}
        </button>
      </div>
    </form>
  );
}

export default function CaseAutoRunRulesSettings({ apiToken, orgSlug, theme }) {
  const [rules, setRules] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [mdmActions, setMdmActions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = edit

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchAll = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const [rulesRes, workflowsRes, actionsRes] = await Promise.all([
        axios.get('/api/case-autorun-rules', { headers }),
        axios.get('/api/workflows', { headers }),
        axios.get('/api/mdm-actions', { headers }),
      ]);
      setRules(rulesRes.data?.items || []);
      setWorkflows(workflowsRes.data?.items || []);
      setMdmActions(actionsRes.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load Case Auto-Run rules.');
    } finally {
      setIsLoading(false);
    }
  }, [apiToken, orgSlug]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSave(data) {
    if (editing && editing.id) {
      await axios.put(`/api/case-autorun-rules/${editing.id}`, data, { headers });
    } else {
      await axios.post('/api/case-autorun-rules', data, { headers });
    }
    setEditing(undefined);
    fetchAll();
  }

  async function handleDelete(rule) {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    await axios.delete(`/api/case-autorun-rules/${rule.id}`, { headers });
    fetchAll();
  }

  const recentFireCount = (rule) => (rule.recentFires || []).length;

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Compliance Policy violations can auto-run a workflow, and Inbound Webhook Triggers always do — but a Case opened manually had no unattended path at all. These rules close that gap: when a manually-created Case matches, its linked device gets the workflow below run against it automatically, once, at creation. Evaluated in order — the first matching enabled rule fires; nothing runs on cases with no linked device, and reopening a case never re-fires a rule.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {editing !== undefined && (
        <RuleForm
          initial={editing}
          workflows={workflows}
          mdmActions={mdmActions}
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onCancel={() => setEditing(undefined)}
          onSave={handleSave}
        />
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : rules.length === 0 && editing === undefined ? (
        <p className="text-xs mb-3" style={{ color: theme.textMuted }}>No Case Auto-Run rules configured yet.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {rules.map(r => {
            const workflow = workflows.find(w => w.id === r.workflowId);
            return (
              <div key={r.id} className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex items-center gap-2">
                    <Target size={14} style={{ color: r.enabled ? PRIMARY_BLUE : theme.textMuted }} className="shrink-0" />
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{r.name}</p>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: r.enabled ? `${SUCCESS}15` : `${theme.textMuted}15`, color: r.enabled ? SUCCESS : theme.textMuted }}>
                      {r.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 uppercase" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>
                      {r.minSeverity}+
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditing(r)} title="Edit" className="p-1.5 rounded-lg" style={{ color: theme.textMuted }}><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(r)} title="Delete" className="p-1.5 rounded-lg" style={{ color: DANGER }}><Trash2 size={13} /></button>
                  </div>
                </div>
                <p className="text-xs" style={{ color: theme.textMuted }}>
                  Runs "{workflow?.name || 'Unknown workflow'}"{r.mitreTechniques?.length ? ` · requires ${r.mitreTechniques.length} MITRE tag${r.mitreTechniques.length === 1 ? '' : 's'}` : ''}
                  {' · '}cap {r.maxFiresPerHour || 10}/hr{recentFireCount(r) ? ` · ${recentFireCount(r)} fired in the last hour` : ''}
                </p>
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
          <Plus size={14} /> New Rule
        </button>
      )}
      {workflows.length === 0 && (
        <p className="text-[10px] mt-2" style={{ color: theme.textMuted }}>Create a Workflow first — rules need one to run.</p>
      )}
    </div>
  );
}
