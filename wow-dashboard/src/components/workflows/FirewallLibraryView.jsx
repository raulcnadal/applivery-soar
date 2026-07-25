import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, ShieldCheck, InfoCircle as Info, DangerTriangle as AlertTriangle } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const PROTOCOLS = ['Any', 'TCP', 'UDP'];
const PROFILES = ['Any', 'Domain', 'Private', 'Public', 'Domain,Private', 'Domain,Public', 'Private,Public'];

function tempId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`;
}

function emptyRule() {
  return { _key: tempId(), name: '', direction: 'inbound', action: 'block', protocol: 'Any', localPorts: 'Any', remoteAddresses: 'Any', profile: 'Any', enabled: true };
}

// `seed` is either an existing saved rule set (has `id`, used for editing),
// a starter template (from GET /api/firewall-ruleset-templates — no `id`),
// or null/undefined (blank — "start from scratch").
function emptyRuleSet(seed) {
  return {
    name: seed?.name || '',
    description: seed?.description || '',
    ensureFirewallEnabled: seed?.ensureFirewallEnabled ?? true,
    defaultInboundAction: seed?.defaultInboundAction || 'notConfigured',
    defaultOutboundAction: seed?.defaultOutboundAction || 'notConfigured',
    rules: (seed?.rules || []).map(r => ({ ...r, _key: r.id || tempId() })),
  };
}

function Field({ label, theme, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
    </div>
  );
}

function RuleRow({ rule, theme, onChange, onRemove }) {
  const inputCls = "w-full px-2 py-1.5 rounded-md text-[11px] outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all";
  const inputStyle = { border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text };
  function set(patch) { onChange({ ...rule, ...patch }); }
  return (
    <div className="p-2.5 rounded-lg border space-y-2" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
      <div className="flex items-center gap-2">
        <input value={rule.name} onChange={e => set({ name: e.target.value })} placeholder="Rule name" className={`${inputCls} flex-1`} style={inputStyle} />
        <label className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: theme.text }}>
          <input type="checkbox" checked={rule.enabled} onChange={e => set({ enabled: e.target.checked })} /> Enabled
        </label>
        <button type="button" onClick={onRemove} title="Remove rule" className="p-1 rounded-md hover:bg-red-500/10 shrink-0" style={{ color: DANGER }}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <Field label="Direction" theme={theme}>
          <select value={rule.direction} onChange={e => set({ direction: e.target.value })} className={inputCls} style={inputStyle}>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </Field>
        <Field label="Action" theme={theme}>
          <select value={rule.action} onChange={e => set({ action: e.target.value })} className={inputCls} style={inputStyle}>
            <option value="block">Block</option>
            <option value="allow">Allow</option>
          </select>
        </Field>
        <Field label="Protocol" theme={theme}>
          <select value={rule.protocol} onChange={e => set({ protocol: e.target.value, ...(e.target.value === 'Any' ? { localPorts: 'Any' } : {}) })} className={inputCls} style={inputStyle}>
            {PROTOCOLS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Local port(s)" theme={theme}>
          <input
            value={rule.localPorts}
            disabled={rule.protocol === 'Any'}
            onChange={e => set({ localPorts: e.target.value })}
            placeholder="Any"
            className={inputCls}
            style={{ ...inputStyle, opacity: rule.protocol === 'Any' ? 0.5 : 1 }}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="Remote address(es)" theme={theme}>
          <input value={rule.remoteAddresses} onChange={e => set({ remoteAddresses: e.target.value })} placeholder="Any, or comma-separated IPs/CIDRs" className={`${inputCls} font-mono`} style={inputStyle} />
        </Field>
        <Field label="Profile" theme={theme}>
          <select value={rule.profile} onChange={e => set({ profile: e.target.value })} className={inputCls} style={inputStyle}>
            {PROFILES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
    </div>
  );
}

function RuleSetForm({ initial, theme, onCancel, onSave }) {
  const [rs, setRs] = useState(() => emptyRuleSet(initial));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const isEditing = !!(initial && initial.id);

  const inputCls = "w-full px-2.5 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all";
  const inputStyle = { border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text };

  function set(patch) { setRs(prev => ({ ...prev, ...patch })); }
  function updateRule(key, next) { setRs(prev => ({ ...prev, rules: prev.rules.map(r => r._key === key ? next : r) })); }
  function removeRule(key) { setRs(prev => ({ ...prev, rules: prev.rules.filter(r => r._key !== key) })); }
  function addRule() { setRs(prev => ({ ...prev, rules: [...prev.rules, emptyRule()] })); }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: rs.name.trim(),
        description: rs.description || '',
        ensureFirewallEnabled: rs.ensureFirewallEnabled,
        defaultInboundAction: rs.defaultInboundAction,
        defaultOutboundAction: rs.defaultOutboundAction,
        rules: rs.rules.map(({ _key, ...r }) => r),
      };
      await onSave(payload);
    } catch (err) {
      setSaveError(err.response?.data?.detail || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3 rounded-lg border shadow-sm space-y-3" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
      <Field label="Name" theme={theme}>
        <input value={rs.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Isolate Device" className={inputCls} style={inputStyle} />
      </Field>
      <Field label="Description (optional)" theme={theme}>
        <input value={rs.description || ''} onChange={e => set({ description: e.target.value })} className={inputCls} style={inputStyle} />
      </Field>

      <label className="flex items-start gap-2 text-[11px] p-2 rounded-lg cursor-pointer" style={{ backgroundColor: theme.bg, color: theme.text }}>
        <input type="checkbox" className="mt-0.5" checked={rs.ensureFirewallEnabled} onChange={e => set({ ensureFirewallEnabled: e.target.checked })} />
        <span>
          <span className="font-semibold">Ensure Windows Firewall is enabled when applying</span>
          <br />
          <span style={{ color: theme.textMuted }}>
            Turn this off for devices with a 3rd-party EDR — EDR agents commonly require Windows Firewall to stay off to avoid conflicting with their own driver-level rules. When off, this rule set only adds/removes its own rules and never touches the firewall's on/off state.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Default inbound action" theme={theme}>
          <select value={rs.defaultInboundAction} onChange={e => set({ defaultInboundAction: e.target.value })} className={inputCls} style={inputStyle}>
            <option value="notConfigured">Leave as-is</option>
            <option value="block">Block (deny by default)</option>
            <option value="allow">Allow (permit by default)</option>
          </select>
        </Field>
        <Field label="Default outbound action" theme={theme}>
          <select value={rs.defaultOutboundAction} onChange={e => set({ defaultOutboundAction: e.target.value })} className={inputCls} style={inputStyle}>
            <option value="notConfigured">Leave as-is</option>
            <option value="block">Block (deny by default)</option>
            <option value="allow">Allow (permit by default)</option>
          </select>
        </Field>
      </div>
      <p className="text-[10px] leading-relaxed" style={{ color: theme.textMuted }}>
        Windows Firewall always lets an explicit Block rule beat an explicit Allow rule, regardless of order — so a genuine "block everything except these exceptions" posture only works by changing the default action here, then adding Allow rules below as the exceptions. Leave both "as-is" for rule sets that just add specific Block/Allow rules (e.g. blocking one port) without changing the fleet-wide default. Restore reverts these to Windows' own out-of-box defaults (inbound Block, outbound Allow).
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium" style={{ color: theme.textMuted }}>Rules ({rs.rules.length})</span>
          <button type="button" onClick={addRule} className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: PRIMARY_BLUE }}>
            <Plus size={11} /> Add rule
          </button>
        </div>
        <div className="space-y-1.5">
          {rs.rules.length === 0 && (
            <p className="text-[10px]" style={{ color: theme.textMuted }}>No rules yet — a rule set with no rules only changes the default posture above, if configured.</p>
          )}
          {rs.rules.map(rule => (
            <RuleRow key={rule._key} rule={rule} theme={theme} onChange={(next) => updateRule(rule._key, next)} onRemove={() => removeRule(rule._key)} />
          ))}
        </div>
      </div>

      {saveError && (
        <p className="inline-flex items-start gap-1 text-[10px]" style={{ color: DANGER }}>
          <AlertTriangle size={10} className="shrink-0 mt-0.5" /> {saveError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ borderColor: theme.border, color: theme.textMuted }}>Cancel</button>
        <button
          type="button"
          disabled={saving || !rs.name.trim()}
          onClick={handleSave}
          className="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          style={{ backgroundColor: PRIMARY_BLUE }}
        >
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add to library'}
        </button>
      </div>
    </div>
  );
}

function TemplatePicker({ templates, theme, onPick, onCancel }) {
  return (
    <div className="p-3 rounded-lg border shadow-sm space-y-2" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
      <p className="text-xs font-semibold" style={{ color: theme.text }}>Start from a template, or build from scratch</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {templates.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(t)}
            className="text-left p-2.5 rounded-lg border hover:bg-blue-500/10 hover:border-blue-500 transition-colors"
            style={{ borderColor: theme.border }}
          >
            <span className="text-xs font-semibold block" style={{ color: theme.text }}>{t.name}</span>
            <span className="text-[10px] block mt-0.5 line-clamp-2" style={{ color: theme.textMuted }}>{t.description}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPick(null)}
          className="text-left p-2.5 rounded-lg border border-dashed hover:bg-blue-500/10 hover:border-blue-500 transition-colors flex items-center"
          style={{ borderColor: theme.border, color: theme.textMuted }}
        >
          <span className="text-xs font-semibold">Start from scratch</span>
        </button>
      </div>
      <div className="flex justify-end pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ borderColor: theme.border, color: theme.textMuted }}>Cancel</button>
      </div>
    </div>
  );
}

export default function FirewallLibraryView({ apiToken, orgSlug, theme }) {
  const [items, setItems] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [addingType, setAddingType] = useState(null); // 'new' | rulesetId | null
  const [pendingTemplate, setPendingTemplate] = useState(undefined); // undefined = not chosen yet, null = blank, object = template
  const [busyId, setBusyId] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  function fetchAll() {
    axios.get('/api/firewall-rulesets', { headers })
      .then(res => setItems(res.data.items || []))
      .catch(() => setItems([]));
  }

  useEffect(() => {
    if (!orgSlug) return;
    fetchAll();
    axios.get('/api/firewall-ruleset-templates', { headers })
      .then(res => setTemplates(res.data.items || []))
      .catch(() => setTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  async function handleCreate(data) {
    await axios.post('/api/firewall-rulesets', data, { headers });
    setAddingType(null);
    setPendingTemplate(undefined);
    fetchAll();
  }
  async function handleUpdate(id, data) {
    await axios.put(`/api/firewall-rulesets/${id}`, data, { headers });
    setAddingType(null);
    fetchAll();
  }
  async function handleDelete(rs) {
    if (!confirm(`Remove "${rs.name}" from the library? Devices it's already been applied to keep those rules until explicitly restored — deleting this only removes the ability to apply/restore it via new workflow runs.`)) return;
    setBusyId(rs.id);
    try {
      await axios.delete(`/api/firewall-rulesets/${rs.id}`, { headers });
      fetchAll();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold" style={{ color: theme.text }}>Firewall Policy Library</h2>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: theme.textMuted }}>
          Windows-only. Build a set of firewall rules once, then reference it from a workflow's "Apply Firewall Rule Set" and "Restore Firewall" steps. Every rule is tagged so it can be cleanly removed later — a device's normal firewall behavior returns automatically once the tagged rules are gone.
        </p>
      </div>

      <div className="space-y-2.5 max-w-2xl">
        {items === null ? (
          <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
        ) : items.length === 0 && addingType !== 'new' ? (
          <p className="text-[11px] leading-relaxed" style={{ color: theme.textMuted }}>Nothing in the library yet.</p>
        ) : (
          items.map(rs => {
            if (addingType === rs.id) {
              return (
                <RuleSetForm
                  key={rs.id}
                  initial={rs}
                  theme={theme}
                  onCancel={() => setAddingType(null)}
                  onSave={(data) => handleUpdate(rs.id, data)}
                />
              );
            }
            const hasDefaultPosture = rs.defaultInboundAction !== 'notConfigured' || rs.defaultOutboundAction !== 'notConfigured';
            return (
              <div key={rs.id} className="flex items-start gap-2.5 p-2.5 rounded-lg border shadow-sm" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
                <ShieldCheck size={14} style={{ color: theme.textMuted }} className="shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold truncate" style={{ color: theme.text }}>{rs.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>
                      {rs.rules?.length || 0} rule{(rs.rules?.length || 0) === 1 ? '' : 's'}
                    </span>
                    {rs.ensureFirewallEnabled ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>Enables Firewall</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>Assumes EDR-managed</span>
                    )}
                    {hasDefaultPosture && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${DANGER}12`, color: DANGER }}>Changes default posture</span>
                    )}
                  </div>
                  {rs.description && <p className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>{rs.description}</p>}
                </div>
                <button type="button" onClick={() => setAddingType(rs.id)} title="Edit" className="p-1.5 rounded-lg hover:bg-blue-500/10 shrink-0" style={{ color: theme.textMuted }}>
                  <Pencil size={13} />
                </button>
                <button type="button" disabled={busyId === rs.id} onClick={() => handleDelete(rs)} title="Remove" className="p-1.5 rounded-lg hover:bg-red-500/10 shrink-0" style={{ color: DANGER }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}

        {addingType === 'new' ? (
          pendingTemplate === undefined ? (
            <TemplatePicker templates={templates} theme={theme} onPick={(t) => setPendingTemplate(t)} onCancel={() => setAddingType(null)} />
          ) : (
            <RuleSetForm theme={theme} initial={pendingTemplate} onCancel={() => setAddingType(null)} onSave={handleCreate} />
          )
        ) : (
          <button
            type="button"
            onClick={() => { setAddingType('new'); setPendingTemplate(undefined); }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-xs font-medium hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
            style={{ borderColor: theme.border, color: theme.textMuted }}
          >
            <Plus size={13} /> Add to library
          </button>
        )}
      </div>

      <p className="inline-flex items-start gap-1.5 text-[10px] mt-4 max-w-2xl" style={{ color: WARNING }}>
        <Info size={11} className="shrink-0 mt-0.5" /> Windows only. Restore only removes the rules tagged with this rule set — it isn't a full firewall snapshot, so the device's prior firewall state returns automatically once the tagged rules are gone, assuming nothing else changed the firewall in between.
      </p>
    </div>
  );
}
