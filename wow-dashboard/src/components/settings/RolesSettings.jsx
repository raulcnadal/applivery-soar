import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, DangerTriangle as AlertTriangle,
  CheckCircle as Check, ShieldCheck, ShieldWarning as ShieldAlert, Tag, UsersGroupRounded as Users,
  AltArrowDown as ChevronDown, AltArrowUp as ChevronUp, RefreshCircle as RefreshCw, InfoCircle as Info,
} from '@solar-icons/react';

const APPLIVERY_ROLES = ['owner', 'admin', 'editor', 'viewer', 'unassigned'];

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const SUCCESS = '#22C55E';

// Mirrors SOAR_FEATURE_AREAS / SOAR_RISKY_ACTIONS in main.py — human labels
// only, the actual keys/values must match exactly since they're sent
// straight through to RolePayload.featureAccess / .riskyActions.
const FEATURE_AREA_LABELS = {
  devices: 'Devices', compliance: 'Compliance Policies', workflows: 'Workflows', cases: 'Cases',
  integrations: 'Integrations & Threat Intel', reporting: 'Reporting & Widgets', settings: 'Settings',
  auditLog: 'Audit Log',
};
const LEVELS = [
  { id: 'none', label: 'No access' },
  { id: 'read', label: 'View only' },
  { id: 'manage', label: 'Manage' },
];
const RISKY_ACTION_LABELS = {
  canDeletePolicyOrWorkflow: 'Delete Compliance Policies or Workflows',
  canRunDestructiveWorkflow: 'Run workflows containing a destructive MDM step (wipe / unenroll / etc.)',
  canEditIntegrationSecrets: 'Create, edit, delete, or test Integrations and Threat Intel providers',
  canExportOrImportConfig: 'Export, import, or clone workspace configuration',
  canBulkTriage: 'Bulk-approve/dismiss violations, or bulk-update Cases',
};

function inputCls(theme) {
  return { border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text };
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

// Free-form tag/value picker — shows any already-known values as one-click
// suggestions (from the live Collaborators directory), but always lets the
// admin type an arbitrary value too. There's no confirmed Applivery API to
// "create" a Collaborator tag, so "create new" here just means: type
// whatever value you expect a collaborator's tag/group field to carry, even
// if no current collaborator happens to have it yet.
function TagValuesEditor({ values, onChange, suggestions, theme }) {
  const [draft, setDraft] = useState('');
  function addValue(v) {
    const val = (v || draft).trim();
    if (!val || values.includes(val)) return;
    onChange([...values, val]);
    setDraft('');
  }
  function removeValue(v) {
    onChange(values.filter(x => x !== v));
  }
  const unusedSuggestions = suggestions.filter(s => !values.includes(s));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
            <Tag size={11} /> {v}
            <button type="button" onClick={() => removeValue(v)} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
        {values.length === 0 && <span className="text-[11px]" style={{ color: theme.textMuted }}>No tag values yet — add one below.</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } }}
          placeholder="Type a tag/group value and press Enter…"
          className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
          style={inputCls(theme)}
        />
        <button type="button" onClick={() => addValue()} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Add</button>
      </div>
      {unusedSuggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] mb-1" style={{ color: theme.textMuted }}>Seen on live collaborators:</p>
          <div className="flex flex-wrap gap-1.5">
            {unusedSuggestions.map(s => (
              <button key={s} type="button" onClick={() => addValue(s)}
                className="px-2 py-1 rounded-full text-[11px] font-medium transition-colors"
                style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}>
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RoleEditor({ initial, featureAreas, riskyActions, directory, directoryLoading, directoryError, onReloadDirectory, theme, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [featureAccess, setFeatureAccess] = useState(() => Object.fromEntries((featureAreas || []).map(a => [a, initial?.featureAccess?.[a] || 'none'])));
  const [risky, setRisky] = useState(() => Object.fromEntries((riskyActions || []).map(a => [a, !!initial?.riskyActions?.[a]])));
  const [tagValues, setTagValues] = useState(initial?.appliveryTagValues || []);
  const [segmentIds, setSegmentIds] = useState(initial?.segmentIds || []);
  const [showRawCollaborators, setShowRawCollaborators] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // availableTags is the canonical org-wide list (GET .../collaborators/
  // groups) — union with tagCandidates seen on fetched collaborators in
  // case the two ever disagree (e.g. a stale/older tenant record).
  const allTagSuggestions = Array.from(new Set([
    ...(directory?.availableTags || []),
    ...(directory?.collaborators || []).flatMap(c => c.tagCandidates || []),
  ]));

  function toggleSegment(id) {
    setSegmentIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), description, featureAccess, riskyActions: risky, appliveryTagValues: tagValues, segmentIds });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save role.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Role name" theme={theme}>
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
        <Field label="Description" theme={theme}>
          <input value={description} onChange={e => setDescription(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
      </div>

      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: theme.text }}>Feature access</p>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: theme.border }}>
          {(featureAreas || []).map((area, i) => (
            <div key={area} className="flex items-center justify-between px-3 py-2 text-xs"
              style={{ borderTop: i > 0 ? `1px solid ${theme.border}` : 'none', backgroundColor: theme.card }}>
              <span style={{ color: theme.text }}>{FEATURE_AREA_LABELS[area] || area}</span>
              <div className="flex gap-1">
                {LEVELS.map(l => (
                  <button key={l.id} type="button" onClick={() => setFeatureAccess(f => ({ ...f, [area]: l.id }))}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                    style={{
                      backgroundColor: featureAccess[area] === l.id ? PRIMARY_BLUE : 'transparent',
                      color: featureAccess[area] === l.id ? '#fff' : theme.textMuted,
                      border: `1px solid ${featureAccess[area] === l.id ? PRIMARY_BLUE : theme.border}`,
                    }}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: theme.text }}>High-risk actions</p>
        <div className="space-y-1.5">
          {(riskyActions || []).map(action => (
            <label key={action} className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer" style={{ border: `1px solid ${theme.border}` }}>
              <input type="checkbox" className="mt-0.5" checked={!!risky[action]} onChange={e => setRisky(r => ({ ...r, [action]: e.target.checked }))} />
              <span style={{ color: theme.text }}>{RISKY_ACTION_LABELS[action] || action}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold" style={{ color: theme.text }}>Applivery collaborator tag / group values</p>
          <button type="button" onClick={onReloadDirectory} className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: PRIMARY_BLUE }}>
            <RefreshCw size={11} className={directoryLoading ? 'animate-spin' : ''} /> {directoryLoading ? 'Loading…' : 'Refresh from Applivery'}
          </button>
        </div>
        <p className="text-[10px] mb-2 leading-relaxed" style={{ color: theme.textMuted }}>
          A collaborator authenticating with any of these tag values (Applivery's own Collaborator "tags" field) is granted this Role. Suggestions below combine the org-wide tag list with anything seen on individual collaborators. Don't see the tag you need yet? Go to Settings &gt; Roles &gt; Collaborators &amp; Tags to assign it directly from here.
        </p>
        {directoryError && <p className="text-[10px] mb-2" style={{ color: DANGER }}>{directoryError}</p>}
        <TagValuesEditor values={tagValues} onChange={setTagValues} suggestions={allTagSuggestions} theme={theme} />
      </div>

      {(directory?.segments || []).length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1" style={{ color: theme.text }}>Segments (optional)</p>
          <p className="text-[10px] mb-2" style={{ color: theme.textMuted }}>Scopes which segment-tagged Compliance Policies this Role's holders can see/manage. Device-level visibility is already limited by Applivery itself.</p>
          <div className="flex flex-wrap gap-1.5">
            {directory.segments.map(seg => {
              const id = seg._id || seg.id;
              const selected = segmentIds.includes(id);
              return (
                <button key={id} type="button" onClick={() => toggleSegment(id)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                  style={{ backgroundColor: selected ? `${PRIMARY_BLUE}18` : 'transparent', color: selected ? PRIMARY_BLUE : theme.textMuted, border: `1px solid ${selected ? PRIMARY_BLUE : theme.border}` }}>
                  {seg.name || id}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(directory?.collaborators || []).length > 0 && (
        <div>
          <button type="button" onClick={() => setShowRawCollaborators(s => !s)} className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: theme.textMuted }}>
            {showRawCollaborators ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Raw collaborator data ({directory.collaborators.length})
          </button>
          {showRawCollaborators && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg p-2 space-y-2" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
              {directory.collaborators.map((c, i) => (
                <div key={c._id || c.id || i} className="text-[10px]">
                  <p className="font-semibold" style={{ color: theme.text }}>{c.email || (c.user || {}).email || 'unknown'} — role: {c.role_normalized}</p>
                  <p style={{ color: theme.textMuted }}>tag candidates found: {(c.tagCandidates || []).length ? c.tagCandidates.join(', ') : 'none'}</p>
                  <pre className="mt-1 p-1.5 rounded overflow-x-auto" style={{ backgroundColor: theme.card, color: theme.textMuted, maxHeight: 90 }}>{JSON.stringify(c, null, 1)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
        <button type="submit" disabled={saving} className="flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Create role')}
        </button>
      </div>
    </form>
  );
}

export default function RolesSettings({ apiToken, orgSlug, theme }) {
  const [view, setView] = useState('roles'); // 'roles' | 'collaborators'
  const [roles, setRoles] = useState([]);
  const [featureAreas, setFeatureAreas] = useState([]);
  const [riskyActions, setRiskyActions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} (new) | role (edit)
  const [directory, setDirectory] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchRoles = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/roles', { headers });
      setRoles(res.data.items || []);
      setFeatureAreas(res.data.featureAreas || []);
      setRiskyActions(res.data.riskyActions || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load Roles.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  const fetchDirectory = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const res = await axios.get('/api/roles/collaborators-directory', { headers });
      setDirectory(res.data);
    } catch (err) {
      setDirectoryError(err.response?.data?.detail || 'Failed to load live collaborators/segments from Applivery.');
    } finally {
      setDirectoryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);
  useEffect(() => { if (editing || view === 'collaborators') fetchDirectory(); }, [editing, view, fetchDirectory]);

  async function handleSave(payload) {
    if (editing?.id) {
      const res = await axios.put(`/api/roles/${editing.id}`, payload, { headers });
      setRoles(rs => rs.map(r => r.id === editing.id ? res.data : r));
    } else {
      const res = await axios.post('/api/roles', payload, { headers });
      setRoles(rs => [...rs, res.data]);
    }
    setEditing(null);
  }

  async function handleDelete(role) {
    if (!window.confirm(`Delete Role "${role.name}"? Collaborators currently mapped to it will lose SOAR access until reassigned.`)) return;
    setDeletingId(role.id);
    try {
      await axios.delete(`/api/roles/${role.id}`, { headers });
      setRoles(rs => rs.filter(r => r.id !== role.id));
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete role.');
    } finally {
      setDeletingId(null);
    }
  }

  if (isLoading) return <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>;

  if (editing) {
    return (
      <RoleEditor
        initial={editing.id ? editing : null}
        featureAreas={featureAreas}
        riskyActions={riskyActions}
        directory={directory}
        directoryLoading={directoryLoading}
        directoryError={directoryError}
        onReloadDirectory={fetchDirectory}
        theme={theme}
        onCancel={() => setEditing(null)}
        onSave={handleSave}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg w-fit" style={{ backgroundColor: `${theme.textMuted}10` }}>
        <button onClick={() => setView('roles')} className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
          style={{ backgroundColor: view === 'roles' ? theme.card : 'transparent', color: view === 'roles' ? theme.text : theme.textMuted }}>
          Roles
        </button>
        <button onClick={() => setView('collaborators')} className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
          style={{ backgroundColor: view === 'collaborators' ? theme.card : 'transparent', color: view === 'collaborators' ? theme.text : theme.textMuted }}>
          Collaborators &amp; Tags
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {view === 'roles' && (
        <div>
          <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
            The Applivery workspace Owner is always Super Admin with full access — this only applies to every other collaborator. Anyone authenticating without a Role mapped to their collaborator tag gets no SOAR access at all, so map a Role to every tag value your admins actually carry.
          </p>

          <button onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 mb-4">
            <Plus size={14} /> Create Role
          </button>

          {roles.length === 0 ? (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs" style={{ backgroundColor: `${PRIMARY_BLUE}0A`, border: `1px solid ${PRIMARY_BLUE}30`, color: theme.textMuted }}>
              <Info size={14} className="shrink-0 mt-0.5" style={{ color: PRIMARY_BLUE }} />
              No Roles yet — until you create one, only the Applivery workspace Owner can access this dashboard.
            </div>
          ) : (
            <div className="space-y-2">
              {roles.map(role => (
                <div key={role.id} className="p-3 rounded-xl flex items-start justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={14} style={{ color: PRIMARY_BLUE }} />
                      <p className="text-sm font-semibold" style={{ color: theme.text }}>{role.name}</p>
                    </div>
                    {role.description && <p className="text-[11px] mt-0.5" style={{ color: theme.textMuted }}>{role.description}</p>}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(role.appliveryTagValues || []).length === 0 ? (
                        <span className="text-[10px] flex items-center gap-1" style={{ color: DANGER }}><ShieldAlert size={10} /> No tag values mapped — unreachable</span>
                      ) : role.appliveryTagValues.map(v => (
                        <span key={v} className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{v}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditing(role)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: theme.textMuted }}><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(role)} disabled={deletingId === role.id} className="p-1.5 rounded-lg hover:opacity-70 disabled:opacity-40" style={{ color: DANGER }}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'collaborators' && (
        <CollaboratorsPanel
          directory={directory}
          directoryLoading={directoryLoading}
          directoryError={directoryError}
          onReload={fetchDirectory}
          headers={headers}
          theme={theme}
        />
      )}
    </div>
  );
}

// Lets a Super Admin assign role + tags to an Applivery Collaborator
// directly, using the confirmed org-scoped PUT .../collaborators/{id}
// endpoint (main.py's update_soar_collaborator) — closes the loop so
// mapping a SOC analyst to a Role doesn't require a separate trip into
// Applivery's own console.
function getCollaboratorEmail(c) {
  return c.email || (c.user || {}).email || '';
}

// Renders the result of POST /api/roles/test-access — the same resolution
// _resolve_soar_access runs at a real login, but on demand. Shown right
// after saving a collaborator's tags (and available on-demand any time)
// specifically to catch the failure mode a real incident surfaced: a tag
// gets written to Applivery, or a Role gets saved, but the two don't
// actually line up (typo, mismatched casing beyond what normalization
// handles, or one side never got saved) — instead of that only showing up
// as a confusing "access denied" report from the affected person minutes
// later, it's visible immediately.
function AccessTestResult({ result, theme }) {
  if (!result) return null;
  if (result.status === 'checking') {
    return <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: theme.textMuted }}><RefreshCw size={10} className="animate-spin" /> Checking live access…</p>;
  }
  if (result.status === 'error') {
    return <p className="text-[10px] mt-2" style={{ color: DANGER }}>Access check failed: {result.detail}</p>;
  }
  const data = result.data;
  const allowed = !!data?.allowed;
  return (
    <div className="mt-2 px-2.5 py-2 rounded-lg text-[10px]" style={{ backgroundColor: allowed ? `${SUCCESS}10` : `${DANGER}10`, border: `1px solid ${allowed ? SUCCESS : DANGER}30` }}>
      <p className="font-semibold flex items-center gap-1" style={{ color: allowed ? SUCCESS : DANGER }}>
        {allowed ? <Check size={11} /> : <ShieldAlert size={11} />}
        {allowed ? (data.isSuperAdmin ? 'Would allow — Super Admin (Owner)' : `Would allow — matched Role "${data.role?.name}" via tag "${data.matchedTagValue}"`) : 'Would deny'}
      </p>
      {!allowed && (
        <div className="mt-1" style={{ color: theme.textMuted }}>
          <p>{data?.deniedReason || 'No reason returned.'}</p>
          {data?.collaboratorFound && (
            <p className="mt-1">
              Live tags on this collaborator right now: {data.liveTagCandidates?.length ? data.liveTagCandidates.join(', ') : '(none)'}
              {' — '}
              tag values mapped across saved Roles: {(data.roleTagValuesChecked || []).flatMap(r => r.tagValues).length
                ? Array.from(new Set((data.roleTagValuesChecked || []).flatMap(r => r.tagValues))).join(', ')
                : '(none — no Role has any tag mapped yet)'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CollaboratorsPanel({ directory, directoryLoading, directoryError, onReload, headers, theme }) {
  const [editingId, setEditingId] = useState(null);
  const [editRole, setEditRole] = useState('unassigned');
  const [editTags, setEditTags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [testResults, setTestResults] = useState({}); // collaboratorId -> {status, data|detail}

  const availableTags = directory?.availableTags || [];

  function startEdit(c) {
    setEditingId(c._id || c.id);
    setEditRole(c.role_normalized || 'unassigned');
    setEditTags(c.tagCandidates || []);
    setSaveError(null);
  }

  async function runAccessTest(collaboratorId, email) {
    if (!email) return;
    setTestResults(r => ({ ...r, [collaboratorId]: { status: 'checking' } }));
    try {
      const res = await axios.post('/api/roles/test-access', { email }, { headers });
      setTestResults(r => ({ ...r, [collaboratorId]: { status: 'done', data: res.data } }));
    } catch (err) {
      setTestResults(r => ({ ...r, [collaboratorId]: { status: 'error', detail: err.response?.data?.detail || 'Could not run access check.' } }));
    }
  }

  async function handleSave(collaboratorId, email) {
    setSaving(true);
    setSaveError(null);
    try {
      await axios.put(`/api/roles/collaborators/${collaboratorId}`, { role: editRole, tags: editTags }, { headers });
      setEditingId(null);
      setSavedId(collaboratorId);
      setTimeout(() => setSavedId(null), 3000);
      await onReload();
      // Verify immediately rather than leaving the admin to find out from
      // a failed login later — this is the exact gap the incident exposed.
      runAccessTest(collaboratorId, email);
    } catch (err) {
      setSaveError(err.response?.data?.detail || 'Failed to update collaborator.');
    } finally {
      setSaving(false);
    }
  }

  if (directoryLoading && !directory) return <p className="text-xs" style={{ color: theme.textMuted }}>Loading collaborators…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] leading-relaxed max-w-xl" style={{ color: theme.textMuted }}>
          Live Applivery Collaborators for this workspace. Editing here writes directly to Applivery (role + tags) — the same data an admin would set in Applivery's own console. After saving, or any time via "Test access," you can verify right here whether a collaborator would actually be granted SOAR access — don't rely on them logging in to find out.
        </p>
        <button onClick={onReload} className="flex items-center gap-1 text-[10px] font-semibold shrink-0" style={{ color: PRIMARY_BLUE }}>
          <RefreshCw size={11} className={directoryLoading ? 'animate-spin' : ''} /> {directoryLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {directoryError && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {directoryError}
        </div>
      )}

      <div className="space-y-2">
        {(directory?.collaborators || []).map((c, i) => {
          const id = c._id || c.id || String(i);
          const email = getCollaboratorEmail(c);
          const isEditing = editingId === id;
          return (
            <div key={id} className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <Users size={14} style={{ color: theme.textMuted }} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{email || 'unknown'}</p>
                    {!isEditing && (
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>{c.role_normalized}</span>
                        {(c.tagCandidates || []).map(t => (
                          <span key={t} className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{t}</span>
                        ))}
                        {(c.tagCandidates || []).length === 0 && <span className="text-[10px]" style={{ color: theme.textMuted }}>no tags</span>}
                      </div>
                    )}
                  </div>
                </div>
                {!isEditing && (
                  <div className="flex items-center gap-2 shrink-0">
                    {savedId === id && <span className="text-[10px] flex items-center gap-1" style={{ color: SUCCESS }}><Check size={11} /> Saved</span>}
                    <button onClick={() => runAccessTest(id, email)} title="Check, right now, whether this collaborator would be granted SOAR access" className="px-2 py-1 rounded-lg text-[10px] font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}>
                      Test access
                    </button>
                    <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: theme.textMuted }}><Pencil size={13} /></button>
                  </div>
                )}
              </div>

              {!isEditing && <AccessTestResult result={testResults[id]} theme={theme} />}

              {isEditing && (
                <div className="mt-3 space-y-3">
                  {saveError && <p className="text-[10px]" style={{ color: DANGER }}>{saveError}</p>}
                  <div>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Applivery role</label>
                    <div className="flex flex-wrap gap-1">
                      {APPLIVERY_ROLES.map(r => (
                        <button key={r} type="button" onClick={() => setEditRole(r)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-colors"
                          style={{
                            backgroundColor: editRole === r ? PRIMARY_BLUE : 'transparent',
                            color: editRole === r ? '#fff' : theme.textMuted,
                            border: `1px solid ${editRole === r ? PRIMARY_BLUE : theme.border}`,
                          }}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Tags</label>
                    <TagValuesEditor values={editTags} onChange={setEditTags} suggestions={availableTags} theme={theme} />
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
                    <button type="button" onClick={() => handleSave(id, email)} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save to Applivery'}
                    </button>
                  </div>
                  {editingId === id && <AccessTestResult result={testResults[id]} theme={theme} />}
                </div>
              )}
            </div>
          );
        })}
        {directory && (directory.collaborators || []).length === 0 && (
          <p className="text-xs" style={{ color: theme.textMuted }}>No collaborators found for this workspace.</p>
        )}
      </div>
    </div>
  );
}
