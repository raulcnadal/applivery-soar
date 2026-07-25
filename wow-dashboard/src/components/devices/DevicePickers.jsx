import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { CloseCircle as X, Magnifer as Search, Layers, ShieldCheck, AddSquare as Plus, UsersGroupRounded as Users, Smartphone, Tag as TagIcon, TrashBinMinimalistic as Trash2 } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';

function ModalShell({ title, onClose, theme, children, wide }) {
  return (
    <div
      className="fixed inset-0 z-[280] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} rounded-2xl shadow-xl overflow-hidden flex flex-col`}
        style={{ backgroundColor: theme.card, maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <h3 className="text-sm font-semibold" style={{ color: theme.text }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 transition-opacity" style={{ color: theme.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

// ─── Segment picker ────────────────────────────────────────────────────────────

export function flattenSegments(nodes, depth = 0) {
  let out = [];
  for (const n of nodes || []) {
    out.push({ ...n, depth });
    const children = n.children || n._realChildren;
    if (children?.length) out = out.concat(flattenSegments(children, depth + 1));
  }
  return out;
}

export function SegmentPickerModal({ segments, currentSegmentId, onSelect, onClose, theme }) {
  const [search, setSearch] = useState('');
  const flat = useMemo(() => [{ id: 0, name: 'Global', depth: 0 }, ...flattenSegments(segments)], [segments]);
  const filtered = flat.filter(s => (s.name || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <ModalShell title="Move to segment" onClose={onClose} theme={theme}>
      <div className="p-4">
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search segments…"
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
        </div>
        <div className="space-y-1">
          {filtered.map((s) => {
            const isCurrent = String(s.id) === String(currentSegmentId ?? 0);
            return (
              <button
                key={`${s.id}-${s.depth}`}
                onClick={() => onSelect(s)}
                disabled={isCurrent}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors disabled:opacity-40"
                style={{ paddingLeft: 12 + s.depth * 16, color: theme.text, backgroundColor: isCurrent ? theme.bg : 'transparent' }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = theme.bg; }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <Layers size={13} style={{ color: theme.textMuted }} />
                {s.name || 'Unnamed'}
                {isCurrent && <span className="ml-auto text-[10px] font-semibold" style={{ color: PRIMARY_BLUE }}>Current</span>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>No segments match "{search}"</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Policy picker ─────────────────────────────────────────────────────────────

export function PolicyPickerModal({ platform, apiToken, orgSlug, excludeIds, onSelect, onClose, theme }) {
  const [policies, setPolicies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios.get('/api/policies', {
      params: { platform },
      headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug },
    }).then(res => {
      if (cancelled) return;
      setPolicies(res.data?.items || []);
    }).catch(err => {
      if (cancelled) return;
      setError(err.response?.data?.detail || 'Failed to load policies.');
    }).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [platform, apiToken, orgSlug]);

  const excluded = new Set((excludeIds || []).filter(Boolean).map(String));
  const available = policies.filter(p => !excluded.has(String(p.id)) && p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <ModalShell title="Assign policy" onClose={onClose} theme={theme}>
      <div className="p-4">
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search policies…"
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
          </div>
        ) : error ? (
          <p className="text-xs text-center py-6" style={{ color: DANGER }}>{error}</p>
        ) : (
          <div className="space-y-1">
            {available.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                style={{ color: theme.text }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.bg; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <ShieldCheck size={13} style={{ color: theme.textMuted }} />
                {p.name}
              </button>
            ))}
            {available.length === 0 && (
              <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>
                {policies.length === 0 ? 'No policies found for this platform.' : 'No more policies available to assign.'}
              </p>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Tag editor ────────────────────────────────────────────────────────────────

export function TagEditorModal({ initialTags, onSave, onClose, theme }) {
  const [tags, setTags] = useState(initialTags || []);
  const [draft, setDraft] = useState('');

  function addTag() {
    const v = draft.trim();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setDraft('');
  }

  function removeTag(t) {
    setTags(tags.filter(x => x !== t));
  }

  return (
    <ModalShell title="Edit tags" onClose={onClose} theme={theme}>
      <div className="p-4">
        <div className="flex flex-wrap gap-1.5 mb-3 min-h-[32px]">
          {tags.map(t => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold uppercase"
              style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}
            >
              {t}
              <button onClick={() => removeTag(t)} className="hover:opacity-60">
                <X size={11} />
              </button>
            </span>
          ))}
          {tags.length === 0 && <span className="text-xs" style={{ color: theme.textMuted }}>No tags yet</span>}
        </div>
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder="Add a tag and press Enter…"
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
          <button
            onClick={addTag}
            className="p-2 rounded-lg text-white shrink-0 bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="flex gap-3 justify-end px-4 pb-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
          Cancel
        </button>
        <button
          onClick={() => onSave(tags)}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Device Audience picker (dropdown + create-new) ────────────────────────────
// Shared by the compliance condition builder's "Device Audience membership"
// condition and the policy builder's new "Apply to devices" step — both need
// the exact same UX: pick an existing audience, or create one on the spot.

function ChipGroup({ options, selected, onToggle, theme, emptyLabel }) {
  if (!options || options.length === 0) {
    return <p className="text-[11px] py-1" style={{ color: theme.textMuted }}>{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => {
        const isOn = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: isOn ? `${PRIMARY_BLUE}18` : 'transparent',
              color: isOn ? PRIMARY_BLUE : theme.textMuted,
              border: `1px solid ${isOn ? PRIMARY_BLUE : theme.border}`,
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function GroupedTagSelector({ label, availableTags, groups, setGroups, theme, emptyLabel }) {
  function addGroup() { setGroups([...(groups || []), []]); }
  function removeGroup(i) { setGroups(groups.filter((_, idx) => idx !== i)); }
  function toggleTag(i, tag) {
    const g = groups[i] || [];
    const next = g.includes(tag) ? g.filter(t => t !== tag) : [...g, tag];
    setGroups(groups.map((grp, idx) => (idx === i ? next : grp)));
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>{label}</p>
        <button type="button" onClick={addGroup} className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: PRIMARY_BLUE }}>
          <Plus size={11} /> Add group
        </button>
      </div>
      {(groups || []).length === 0 && (
        <p className="text-[11px]" style={{ color: theme.textMuted }}>No groups — device match isn't limited by {label.toLowerCase()}.</p>
      )}
      <div className="space-y-2">
        {(groups || []).map((g, i) => (
          <div key={i} className="rounded-lg p-2" style={{ border: `1px solid ${theme.border}` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold" style={{ color: theme.textMuted }}>Group {i + 1} (OR)</span>
              <button type="button" onClick={() => removeGroup(i)} style={{ color: DANGER }}><Trash2 size={11} /></button>
            </div>
            <ChipGroup options={availableTags} selected={g} onToggle={(t) => toggleTag(i, t)} theme={theme} emptyLabel={emptyLabel} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DeviceAudienceCreateModal({ apiToken, orgSlug, theme, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deviceTags, setDeviceTags] = useState([]);
  const [employeeTags, setEmployeeTags] = useState([]);
  const [deviceTagGroups, setDeviceTagGroups] = useState([]);
  const [employeeTagGroups, setEmployeeTagGroups] = useState([]);
  const [serialDraft, setSerialDraft] = useState('');
  const [serials, setSerials] = useState([]);
  const [allDevices, setAllDevices] = useState([]);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeResults, setEmployeeResults] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState([]); // [{id, label}]
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  useEffect(() => {
    axios.get('/api/device-tags', { headers }).then(res => setDeviceTags(res.data?.items || [])).catch(() => {});
    axios.get('/api/mdm-user-tags', { headers }).then(res => setEmployeeTags(res.data?.items || [])).catch(() => {});
    axios.get('/api/devices', { headers }).then(res => setAllDevices(res.data?.items || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = employeeSearch.trim();
    if (!term) { setEmployeeResults([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      axios.get('/api/mdm-users', { params: { search: term }, headers }).then(res => {
        if (!cancelled) setEmployeeResults(res.data?.items || []);
      }).catch(() => {});
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeSearch]);

  function addSerial() {
    const v = serialDraft.trim();
    if (v && !serials.includes(v)) setSerials([...serials, v]);
    setSerialDraft('');
  }

  function toggleDevice(dev) {
    setSelectedDeviceIds(ids => ids.includes(dev.id) ? ids.filter(i => i !== dev.id) : [...ids, dev.id]);
  }

  function toggleEmployee(u) {
    setSelectedEmployees(list => list.some(e => e.id === u.id) ? list.filter(e => e.id !== u.id) : [...list, { id: u.id, label: u.name || u.email }]);
  }

  const filteredDevices = deviceSearch.trim()
    ? allDevices.filter(d => (d.displayName || '').toLowerCase().includes(deviceSearch.toLowerCase()) || (d.serialNumber || '').toLowerCase().includes(deviceSearch.toLowerCase()))
    : allDevices.slice(0, 25);

  async function handleCreate() {
    if (!name.trim()) { setError('Give the audience a name.'); return; }
    setIsSaving(true);
    setError(null);

    const selectedDevices = allDevices.filter(d => selectedDeviceIds.includes(d.id));
    const byPlatform = { emmDeviceIds: [], admDeviceIds: [], winDeviceIds: [], aosDeviceIds: [] };
    for (const d of selectedDevices) {
      const pid = d.platformDeviceId || d.id;
      if (d.platform === 'android') byPlatform.emmDeviceIds.push(pid);
      else if (d.platform === 'apple' || d.platform === 'macos') byPlatform.admDeviceIds.push(pid);
      else if (d.platform === 'windows') byPlatform.winDeviceIds.push(pid);
      else if (d.platform === 'aosp') byPlatform.aosDeviceIds.push(pid);
    }

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      selectors: {
        deviceGroups: deviceTagGroups.filter(g => g.length > 0),
        mdmUserGroups: employeeTagGroups.filter(g => g.length > 0),
        serialNumbers: serials,
        mdmUserIds: selectedEmployees.map(e => e.id),
        ...byPlatform,
      },
    };

    try {
      const res = await axios.post('/api/device-audiences', body, { headers });
      onCreated(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create the audience.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ModalShell title="Create Device Audience" onClose={onClose} theme={theme} wide>
      <div className="p-4 space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: `${DANGER}12`, color: DANGER, border: `1px solid ${DANGER}30` }}>
            {error}
          </div>
        )}

        <div className="space-y-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Audience name, e.g. EU Sales Fleet"
            className="w-full px-3 py-2 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
        </div>

        <GroupedTagSelector
          label="Device tags"
          availableTags={deviceTags}
          groups={deviceTagGroups}
          setGroups={setDeviceTagGroups}
          theme={theme}
          emptyLabel="No device tags found in the fleet yet."
        />

        <GroupedTagSelector
          label="Employee tags"
          availableTags={employeeTags}
          groups={employeeTagGroups}
          setGroups={setEmployeeTagGroups}
          theme={theme}
          emptyLabel="No employee tags found yet."
        />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: theme.textMuted }}>Serial numbers</p>
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
            {serials.map(s => (
              <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                {s}
                <button onClick={() => setSerials(serials.filter(x => x !== s))} className="hover:opacity-60"><X size={10} /></button>
              </span>
            ))}
            {serials.length === 0 && <span className="text-[11px]" style={{ color: theme.textMuted }}>None added</span>}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={serialDraft}
              onChange={(e) => setSerialDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSerial(); } }}
              placeholder="Serial number, press Enter…"
              className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            />
            <button onClick={addSerial} className="p-1.5 rounded-lg text-white shrink-0 bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"><Plus size={13} /></button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
            <Smartphone size={11} /> Add devices {selectedDeviceIds.length > 0 && `(${selectedDeviceIds.length} selected)`}
          </p>
          <input
            value={deviceSearch}
            onChange={(e) => setDeviceSearch(e.target.value)}
            placeholder="Search devices by name or serial…"
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none mb-1.5 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
          <div className="max-h-32 overflow-y-auto rounded-lg" style={{ border: `1px solid ${theme.border}` }}>
            {filteredDevices.map(d => (
              <label key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer" style={{ color: theme.text, borderBottom: `1px solid ${theme.border}` }}>
                <input type="checkbox" checked={selectedDeviceIds.includes(d.id)} onChange={() => toggleDevice(d)} />
                <span className="truncate">{d.displayName}</span>
                <span className="ml-auto text-[10px] shrink-0" style={{ color: theme.textMuted }}>{d.platformLabel || d.platform}</span>
              </label>
            ))}
            {filteredDevices.length === 0 && <p className="text-[11px] text-center py-3" style={{ color: theme.textMuted }}>No devices match.</p>}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
            <Users size={11} /> Add employees {selectedEmployees.length > 0 && `(${selectedEmployees.length} selected)`}
          </p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {selectedEmployees.map(e => (
              <span key={e.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                {e.label}
                <button onClick={() => setSelectedEmployees(selectedEmployees.filter(x => x.id !== e.id))} className="hover:opacity-60"><X size={10} /></button>
              </span>
            ))}
          </div>
          <input
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            placeholder="Search employees by name or email…"
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none mb-1.5 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
          {employeeResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-lg" style={{ border: `1px solid ${theme.border}` }}>
              {employeeResults.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer" style={{ color: theme.text, borderBottom: `1px solid ${theme.border}` }}>
                  <input type="checkbox" checked={selectedEmployees.some(e => e.id === u.id)} onChange={() => toggleEmployee(u)} />
                  <span className="truncate">{u.name}</span>
                  <span className="ml-auto text-[10px] truncate" style={{ color: theme.textMuted }}>{u.email}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-3 justify-end px-4 pb-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={isSaving}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          {isSaving ? 'Creating…' : 'Create audience'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Reusable "pick or create" fields for the compliance policy builder ───────

export function AudiencePickerField({ value, audiences, onSelect, onCreated, apiToken, orgSlug, theme }) {
  const [isCreating, setIsCreating] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2">
        <select
          value={value || ''}
          onChange={(e) => onSelect(e.target.value)}
          className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
        >
          <option value="">{(audiences || []).length ? 'Select a Device Audience…' : 'No Device Audiences found'}</option>
          {(audiences || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          style={{ border: `1px solid ${theme.border}`, color: theme.text }}
        >
          <Plus size={12} /> New
        </button>
      </div>
      {isCreating && (
        <DeviceAudienceCreateModal
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setIsCreating(false)}
          onCreated={(aud) => {
            setIsCreating(false);
            onCreated(aud);
            onSelect(aud.id);
          }}
        />
      )}
    </>
  );
}

export function TagConditionField({ value, availableTags, onSelect, theme }) {
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const knownValue = value && (availableTags || []).includes(value);

  if (isAdding || (value && !knownValue)) {
    return (
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <TagIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
          <input
            autoFocus
            value={isAdding ? draft : value}
            onChange={(e) => (isAdding ? setDraft(e.target.value) : onSelect(e.target.value))}
            placeholder="New tag name…"
            className="w-full pl-7 pr-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
        </div>
        {isAdding && (
          <button
            type="button"
            onClick={() => { if (draft.trim()) { onSelect(draft.trim()); setIsAdding(false); setDraft(''); } }}
            className="px-2 py-1.5 rounded-lg text-xs font-medium text-white shrink-0 bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          >
            Use
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value || ''}
        onChange={(e) => { if (e.target.value === '__new__') { setIsAdding(true); } else { onSelect(e.target.value); } }}
        className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
        style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
      >
        <option value="">{(availableTags || []).length ? 'Select a tag…' : 'No tags found'}</option>
        {(availableTags || []).map(t => <option key={t} value={t}>{t}</option>)}
        <option value="__new__">+ Create new tag…</option>
      </select>
    </div>
  );
}
