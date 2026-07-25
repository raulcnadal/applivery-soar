import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, CodeFile as FileCode2, Command as Terminal, InfoCircle as Info, Magnifer as Search, DangerTriangle as AlertTriangle, CloudDownload as CloudDownloadIcon, LinkCircle as LinkIcon, Eye } from '@solar-icons/react';
import { FetchFromApplieryModal, ScriptRepoModal, ScriptContentModal } from './ScriptLibraryModals';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const PLATFORM_LABELS = { windows: 'Windows', macos: 'macOS' };
const TYPE_META = {
  script: {
    label: 'Script',
    Icon: FileCode2,
    hint: "Runs a script Asset directly on the device — no Policy assignment involved. Scripts live in Applivery's own Assets library (Resources > Scripts in the Applivery Dashboard, or Applivery's public GitHub script repo, imported the same way); search below to find one already uploaded there. This is an undocumented Applivery mechanism confirmed to work for both Windows and macOS — watch your first few real runs to be sure.",
  },
  oma_uri: {
    label: 'OMA-URI command',
    Icon: Terminal,
    hint: 'A direct, one-off Windows CSP command (not part of a Policy). The Value field supports {{ device.x }} variables, resolved right before the command is sent.',
  },
};

const DEVICE_VARS = ['device.displayName', 'device.serialNumber', 'device.osVersion', 'device.manufacturer', 'device.model', 'device.udid', 'device.mdmUser.email', 'device.mdmUser.name'];

// The set Applivery itself resolves for script `arguments` at execution time
// (docs.applivery.com/en/device-management/windows/policies/scripts) — a
// different, narrower list than DEVICE_VARS above, which is our OWN local
// {{ device.x }} templating used for oma_uri's `value`. Scripts are NOT
// templated locally (see backend runScript branch) — Applivery interpolates
// these itself, so only variables it actually supports belong here. Inserted
// pre-quoted since Applivery splits `arguments` on whitespace and recommends
// wrapping multi-word/variable values in double quotes.
const SCRIPT_VARS = ['device.id', 'device.displayName', 'device.serialNumber', 'device.osVersion', 'device.chip', 'device.hostName', 'user.id', 'user.email', 'user.name'];

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function emptyEntry(type) {
  if (type === 'oma_uri') return { type, name: '', description: '', platform: 'windows', path: '', action: 'Replace', format: 'chr', value: '' };
  return { type, name: '', description: '', platform: 'windows', assetId: '', assetName: '', arguments: '', scope: 'machine' };
}

const SCRIPT_TEMPLATE = { windows: '# PowerShell\n', macos: '#!/bin/bash\n' };

function Field({ label, theme, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
    </div>
  );
}

function EntryForm({ initial, theme, headers, onCancel, onSave, onContentSaved }) {
  const [entry, setEntry] = useState(initial || emptyEntry('script'));
  const [saving, setSaving] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetResults, setAssetResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [manualAssetId, setManualAssetId] = useState('');
  const [scriptMode, setScriptMode] = useState('existing'); // 'existing' | 'new' — only offered when creating a brand-new entry
  const [newScriptContent, setNewScriptContent] = useState(SCRIPT_TEMPLATE[(initial || emptyEntry('script')).platform] || '');
  const [exposeToChildren, setExposeToChildren] = useState(true);
  const [createError, setCreateError] = useState(null);
  const [contentModalOpen, setContentModalOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(assetSearch, 350);
  const reqIdRef = useRef(0);
  const isEditing = !!initial;

  const inputCls = "w-full px-2.5 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all";
  const inputStyle = { border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text };

  function set(patch) { setEntry(prev => ({ ...prev, ...patch })); }

  useEffect(() => {
    if (entry.type !== 'script' || debouncedSearch.trim().length < 2) { setAssetResults([]); setSearchError(null); return; }
    const myReq = ++reqIdRef.current;
    setSearching(true);
    setSearchError(null);
    axios.get('/api/script-assets', { headers, params: { platform: entry.platform, text: debouncedSearch.trim() } })
      .then(res => {
        if (reqIdRef.current !== myReq) return;
        setAssetResults(res.data?.items || []);
        setSearchError(res.data?.error || null);
      })
      .catch(err => {
        if (reqIdRef.current !== myReq) return;
        setAssetResults([]);
        setSearchError(err.response?.data?.detail || err.message || 'Search failed');
      })
      .finally(() => { if (reqIdRef.current === myReq) setSearching(false); });
  }, [debouncedSearch, entry.type, entry.platform, headers]);

  return (
    <div className="p-3 rounded-lg border shadow-sm space-y-2.5" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type" theme={theme}>
          <select value={entry.type} disabled={isEditing} onChange={e => set(emptyEntry(e.target.value))} className={inputCls} style={inputStyle}>
            {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Platform" theme={theme}>
          <select
            value={entry.platform}
            onChange={e => set({ platform: e.target.value, ...(entry.type === 'script' ? { assetId: '', assetName: '' } : {}) })}
            disabled={entry.type === 'oma_uri'}
            className={inputCls}
            style={inputStyle}
          >
            {entry.type === 'oma_uri' ? <option value="windows">Windows</option> : Object.entries(PLATFORM_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Name" theme={theme}>
        <input value={entry.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Reset BitLocker key" className={inputCls} style={inputStyle} />
      </Field>
      <Field label="Description (optional)" theme={theme}>
        <input value={entry.description || ''} onChange={e => set({ description: e.target.value })} className={inputCls} style={inputStyle} />
      </Field>

      <p className="text-[10px] leading-relaxed" style={{ color: theme.textMuted }}>{TYPE_META[entry.type]?.hint}</p>

      {entry.type === 'script' && (
        <>
          {!isEditing && (
            <div className="flex gap-1.5 p-0.5 rounded-lg" style={{ backgroundColor: theme.bg }}>
              {[['existing', 'Pick existing script'], ['new', 'Write new script']].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setScriptMode(k)}
                  className="flex-1 py-1 rounded-md text-[11px] font-medium transition-colors"
                  style={scriptMode === k ? { backgroundColor: theme.card, color: theme.text, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: theme.textMuted }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {(isEditing || scriptMode === 'existing') && (
            <>
              {!entry.assetId && (
                <Field label={`Search ${PLATFORM_LABELS[entry.platform]} script Assets`} theme={theme}>
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: theme.textMuted }} />
                    <input
                      value={assetSearch}
                      onChange={e => setAssetSearch(e.target.value)}
                      placeholder="Script name…"
                      className={inputCls}
                      style={{ ...inputStyle, paddingLeft: 26 }}
                    />
                  </div>
                  {searching && <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>Searching…</p>}
                  {searchError && (
                    <p className="inline-flex items-start gap-1 text-[10px] mt-1" style={{ color: DANGER }}>
                      <AlertTriangle size={10} className="shrink-0 mt-0.5" /> {searchError}
                    </p>
                  )}
                  {assetResults.length > 0 && (
                    <div className="mt-1.5 rounded-lg border max-h-36 overflow-y-auto" style={{ borderColor: theme.border }}>
                      {assetResults.map(a => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => { set({ assetId: a.id, assetName: a.name }); setAssetSearch(''); setAssetResults([]); }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-blue-500/10 text-xs"
                          style={{ color: theme.text, borderTop: `1px solid ${theme.border}` }}
                        >
                          <FileCode2 size={12} className="shrink-0" style={{ color: theme.textMuted }} />
                          <span className="truncate flex-1">{a.name}</span>
                          <Plus size={12} className="shrink-0" style={{ color: PRIMARY_BLUE }} />
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
              )}

              {entry.assetId ? (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: theme.bg }}>
                  <FileCode2 size={12} style={{ color: theme.textMuted }} className="shrink-0" />
                  <span className="text-xs flex-1 truncate" style={{ color: theme.text }}>{entry.assetName || entry.assetId}</span>
                  <span className="text-[9px] font-mono truncate max-w-[25%]" style={{ color: theme.textMuted }}>{entry.assetId}</span>
                  {isEditing && (
                    <button type="button" onClick={() => setContentModalOpen(true)} className="text-[10px] px-1.5 inline-flex items-center gap-1" style={{ color: PRIMARY_BLUE }}>
                      <Eye size={11} /> Content
                    </button>
                  )}
                  <button type="button" onClick={() => set({ assetId: '', assetName: '' })} className="text-[10px] px-1.5" style={{ color: DANGER }}>Clear</button>
                </div>
              ) : (
                <Field label="Or paste an Asset ID directly" theme={theme}>
                  <div className="flex gap-1.5">
                    <input value={manualAssetId} onChange={e => setManualAssetId(e.target.value)} placeholder="507f1f77bcf86cd799439077" className={`${inputCls} font-mono`} style={inputStyle} />
                    <button
                      type="button"
                      disabled={!manualAssetId.trim()}
                      onClick={() => { set({ assetId: manualAssetId.trim(), assetName: '' }); setManualAssetId(''); }}
                      className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
                      style={{ backgroundColor: PRIMARY_BLUE }}
                    >
                      Use
                    </button>
                  </div>
                </Field>
              )}
            </>
          )}

          {!isEditing && scriptMode === 'new' && (
            <>
              <Field label={`New ${PLATFORM_LABELS[entry.platform]} script content`} theme={theme}>
                <textarea
                  value={newScriptContent}
                  onChange={e => setNewScriptContent(e.target.value)}
                  rows={8}
                  className={`${inputCls} font-mono resize-none`}
                  style={inputStyle}
                />
              </Field>
              <label className="flex items-center gap-2 text-[10px]" style={{ color: theme.text }}>
                <input type="checkbox" checked={exposeToChildren} onChange={e => setExposeToChildren(e.target.checked)} />
                Expose to child segments
              </label>
              {createError && (
                <p className="inline-flex items-start gap-1 text-[10px]" style={{ color: DANGER }}>
                  <AlertTriangle size={10} className="shrink-0 mt-0.5" /> {createError}
                </p>
              )}
              <p className="text-[10px] leading-relaxed" style={{ color: theme.textMuted }}>Saving uploads this as a new script Asset on Applivery under the Global segment, then adds it to the library. Leave "Expose to child segments" on so it's usable on workflows targeting devices in any segment.</p>
            </>
          )}

          {contentModalOpen && entry.assetId && (
            <ScriptContentModal
              theme={theme}
              headers={headers}
              mode="edit"
              assetId={entry.assetId}
              assetName={entry.assetName}
              platform={entry.platform}
              onClose={() => setContentModalOpen(false)}
              onSaved={(newAsset) => {
                set({ assetId: newAsset.id, assetName: newAsset.name });
                setContentModalOpen(false);
                if (onContentSaved) onContentSaved();
              }}
            />
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Execution scope" theme={theme}>
              <select value={entry.scope || 'machine'} onChange={e => set({ scope: e.target.value })} className={inputCls} style={inputStyle}>
                <option value="machine">Machine (system-level)</option>
                <option value="user">User (current session)</option>
              </select>
            </Field>
          </div>

          <Field label="Arguments (optional)" theme={theme}>
            <textarea
              value={entry.arguments || ''}
              onChange={e => set({ arguments: e.target.value })}
              placeholder={'e.g. --label "My Application" "{{user.name}}"'}
              rows={2}
              className={`${inputCls} font-mono resize-none`}
              style={inputStyle}
            />
          </Field>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {SCRIPT_VARS.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => set({ arguments: `${entry.arguments || ''}"{{${v}}}"` })}
                className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: theme.textMuted }}>
            Applivery splits Arguments on whitespace and resolves these variables itself when the script runs — wrap multi-word values and variables in double quotes to keep them as one parameter (e.g. <code>"{'{{user.name}}'}"</code>), and escape a literal backslash or quote with <code>\</code> (e.g. <code>C:\\Program Files\\MyApp</code>).
          </p>
        </>
      )}

      {entry.type === 'oma_uri' && (
        <>
          <Field label="OMA-URI / CSP path" theme={theme}>
            <input value={entry.path || ''} onChange={e => set({ path: e.target.value })} placeholder="./Vendor/MSFT/Policy/Config/..." className={`${inputCls} font-mono`} style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Action" theme={theme}>
              <select value={entry.action || 'Replace'} onChange={e => set({ action: e.target.value })} className={inputCls} style={inputStyle}>
                {['Add', 'Replace', 'Delete', 'Exec', 'Get', 'Copy'].map(a => <option key={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Format" theme={theme}>
              <select value={entry.format || 'chr'} onChange={e => set({ format: e.target.value })} className={inputCls} style={inputStyle}>
                {['chr', 'int', 'bool', 'xml', 'b64', 'bin', 'node', 'null', 'date', 'time', 'float'].map(f => <option key={f}>{f}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Value (optional)" theme={theme}>
            <input value={entry.value || ''} onChange={e => set({ value: e.target.value })} placeholder="e.g. {{ device.serialNumber }}" className={`${inputCls} font-mono`} style={inputStyle} />
          </Field>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {DEVICE_VARS.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => set({ value: `${entry.value || ''}{{ ${v} }}` })}
                className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}
              >
                {`{{ ${v} }}`}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ borderColor: theme.border, color: theme.textMuted }}>Cancel</button>
        <button
          type="button"
          disabled={
            saving || !entry.name.trim() ||
            (entry.type === 'oma_uri' && !entry.path.trim()) ||
            (entry.type === 'script' && ((isEditing || scriptMode === 'existing') ? !entry.assetId : !newScriptContent.trim()))
          }
          onClick={async () => {
            setSaving(true);
            setCreateError(null);
            try {
              let toSave = entry;
              if (entry.type === 'script' && !isEditing && scriptMode === 'new') {
                const res = await axios.post('/api/script-assets', { name: entry.name, description: entry.description, platform: entry.platform, content: newScriptContent, exposeToChildren }, { headers });
                toSave = { ...entry, assetId: res.data.id, assetName: res.data.name };
              }
              await onSave(toSave);
            } catch (err) {
              setCreateError(err.response?.data?.detail || err.message || 'Save failed');
            } finally {
              setSaving(false);
            }
          }}
          className="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          style={{ backgroundColor: PRIMARY_BLUE }}
        >
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add to library'}
        </button>
      </div>
    </div>
  );
}

const LIBRARY_TYPE_FILTERS = [['all', 'All'], ['script', 'Scripts'], ['oma_uri', 'OMA-URI']];
const LIBRARY_PLATFORM_FILTERS = [['all', 'All platforms'], ['windows', 'Windows'], ['macos', 'macOS']];

export default function ActionLibraryView({ apiToken, orgSlug, theme }) {
  const [items, setItems] = useState(null);
  const [addingType, setAddingType] = useState(null); // 'new' | entryId | null
  const [busyId, setBusyId] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [fetchModalOpen, setFetchModalOpen] = useState(false);
  const [repoModalOpen, setRepoModalOpen] = useState(false);

  // Critical: /api/script-assets is an Applivery-backed endpoint (needs the
  // real Applivery bearer, not just the dashboard-auth headers the global
  // axios interceptor injects automatically) — same pattern as
  // WorkflowsView/PolicyBuilder/AppListsView.
  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  function fetchAll() {
    axios.get('/api/action-library', { headers })
      .then(res => setItems(res.data.items || []))
      .catch(() => setItems([]));
  }

  useEffect(() => {
    if (!orgSlug) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  async function handleCreate(data) {
    await axios.post('/api/action-library', data, { headers });
    setAddingType(null);
    fetchAll();
  }
  async function handleUpdate(id, data) {
    await axios.put(`/api/action-library/${id}`, data, { headers });
    setAddingType(null);
    fetchAll();
  }
  async function handleDelete(entry) {
    if (!confirm(`Remove "${entry.name}" from the library? Workflow steps that reference it will start failing.`)) return;
    setBusyId(entry.id);
    try { await axios.delete(`/api/action-library/${entry.id}`, { headers }); fetchAll(); }
    finally { setBusyId(null); }
  }

  const filteredItems = (items || []).filter(e =>
    (typeFilter === 'all' || e.type === typeFilter) &&
    (typeFilter !== 'script' || platformFilter === 'all' || e.platform === platformFilter)
  );

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold" style={{ color: theme.text }}>Script & OMA-URI Library</h2>
          <p className="text-sm mt-1" style={{ color: theme.textMuted }}>
            Named references you can pick from a workflow's "Run script" and "Custom OMA-URI command" steps, instead of retyping an Asset ID or path/value every time.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={() => setFetchModalOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-blue-500/10 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ borderColor: theme.border, color: theme.text }}>
            <CloudDownloadIcon size={13} /> Fetch from Applivery
          </button>
          <button type="button" onClick={() => setRepoModalOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-blue-500/10 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ borderColor: theme.border, color: theme.text }}>
            <LinkIcon size={13} /> Import from Git repo
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 max-w-2xl flex-wrap">
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ backgroundColor: theme.bg }}>
          {LIBRARY_TYPE_FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTypeFilter(k)}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={typeFilter === k ? { backgroundColor: theme.card, color: theme.text, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: theme.textMuted }}
            >
              {label}
            </button>
          ))}
        </div>
        {typeFilter === 'script' && (
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ backgroundColor: theme.bg }}>
            {LIBRARY_PLATFORM_FILTERS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPlatformFilter(k)}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
                style={platformFilter === k ? { backgroundColor: theme.card, color: theme.text, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: theme.textMuted }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2.5 max-w-2xl">
        {items === null ? (
          <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
        ) : items.length === 0 && addingType !== 'new' ? (
          <p className="text-[11px] leading-relaxed" style={{ color: theme.textMuted }}>Nothing in the library yet.</p>
        ) : filteredItems.length === 0 && addingType !== 'new' ? (
          <p className="text-[11px] leading-relaxed" style={{ color: theme.textMuted }}>Nothing matches this filter.</p>
        ) : (
          filteredItems.map(entry => {
            if (addingType === entry.id) {
              return <EntryForm key={entry.id} initial={entry} theme={theme} headers={headers} onCancel={() => setAddingType(null)} onSave={(data) => handleUpdate(entry.id, data)} onContentSaved={() => { setAddingType(null); fetchAll(); }} />;
            }
            const meta = TYPE_META[entry.type] || {};
            const Icon = meta.Icon || FileCode2;
            return (
              <div key={entry.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border shadow-sm" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
                <Icon size={14} style={{ color: theme.textMuted }} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold truncate" style={{ color: theme.text }}>{entry.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{meta.label}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>{PLATFORM_LABELS[entry.platform] || entry.platform}</span>
                    {entry.type === 'script' && entry.scope && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 capitalize" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>{entry.scope}</span>
                    )}
                  </div>
                  {entry.description && <p className="text-[10px] mt-0.5 truncate" style={{ color: theme.textMuted }}>{entry.description}</p>}
                  {entry.type === 'script' && <p className="text-[10px] mt-0.5 truncate font-mono" style={{ color: theme.textMuted }}>Asset: {entry.assetName || entry.assetId}</p>}
                  {entry.type === 'oma_uri' && <p className="text-[10px] mt-0.5 truncate font-mono" style={{ color: theme.textMuted }}>{entry.path}</p>}
                </div>
                <button type="button" onClick={() => setAddingType(entry.id)} title="Edit" className="p-1.5 rounded-lg hover:bg-blue-500/10 shrink-0" style={{ color: theme.textMuted }}>
                  <Pencil size={13} />
                </button>
                <button type="button" disabled={busyId === entry.id} onClick={() => handleDelete(entry)} title="Remove" className="p-1.5 rounded-lg hover:bg-red-500/10 shrink-0" style={{ color: DANGER }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}

        {addingType === 'new' ? (
          <EntryForm theme={theme} headers={headers} onCancel={() => setAddingType(null)} onSave={handleCreate} />
        ) : (
          <button type="button" onClick={() => setAddingType('new')} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-xs font-medium hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ borderColor: theme.border, color: theme.textMuted }}>
            <Plus size={13} /> Add to library
          </button>
        )}

        {fetchModalOpen && (
          <FetchFromApplieryModal theme={theme} headers={headers} onClose={() => setFetchModalOpen(false)} onImported={fetchAll} />
        )}
        {repoModalOpen && (
          <ScriptRepoModal theme={theme} headers={headers} onClose={() => setRepoModalOpen(false)} onImported={fetchAll} />
        )}
      </div>

      <p className="inline-flex items-start gap-1.5 text-[10px] mt-4 max-w-2xl" style={{ color: WARNING }}>
        <Info size={11} className="shrink-0 mt-0.5" /> Script execution here is a direct, per-device push using an undocumented (but confirmed working) Applivery mechanism. Unlike OMA-URI's Value field, script Arguments are sent as-is — Applivery resolves <code>{'{{device.x}}'}</code> / <code>{'{{user.x}}'}</code> variables itself at execution time.
      </p>
    </div>
  );
}
