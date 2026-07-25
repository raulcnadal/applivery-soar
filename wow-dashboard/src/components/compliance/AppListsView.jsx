import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { CloseCircle as X, AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, Magnifer as Search, ShieldWarning as ShieldAlert, ShieldCheck, ChecklistMinimalistic as ListChecks, InfoCircle as Info, DangerTriangle as AlertTriangle, Refresh as RefreshCw, ClockCircle as Clock, SpeedometerLow as Gauge } from '@solar-icons/react';
import ViewSwitcher from '../shared/ViewSwitcher';
import HelpIcon from '../shared/HelpIcon';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';
const SUCCESS = '#22C55E';

function formatAgeMinutes(minutes) {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

const PLATFORM_LABELS = { apple: 'iOS', macos: 'macOS', android: 'Android', windows: 'Windows' };
const PLATFORM_OPTIONS = ['apple', 'macos', 'android', 'windows'];

// Mirrors SEARCH_SOURCES_BY_PLATFORM in main.py — keep in sync. First entry
// in each list is the default source shown when the platform is selected.
const SOURCES_BY_PLATFORM = {
  apple: [{ id: 'apple_store', label: 'Apple App Store' }],
  macos: [{ id: 'apple_store', label: 'Apple App Store' }, { id: 'homebrew', label: 'Homebrew (Cask)' }],
  windows: [{ id: 'ms_store', label: 'Microsoft Store' }, { id: 'winget', label: 'Winget' }],
  android: [{ id: 'android_known', label: 'Known Apps' }],
};

// Curated starting points — well-known, commonly-cited identifiers to save
// admins the first search. Not guaranteed 100% current (app publishers do
// occasionally change bundle IDs), so treat as a convenience seed, not an
// authority — worth spot-checking a first result against a real device
// before relying on it for enforcement. Windows is deliberately omitted:
// there's no identifier convention we're confident enough in to hardcode
// (see the app-search backend comments on Windows identifier uncertainty).
const PRESETS = {
  apple: [
    { label: 'Common browsers', apps: [
      { identifier: 'com.apple.mobilesafari', name: 'Safari' },
      { identifier: 'com.google.chrome.ios', name: 'Chrome' },
      { identifier: 'org.mozilla.ios.Firefox', name: 'Firefox' },
    ]},
    { label: 'Collaboration apps', apps: [
      { identifier: 'com.tinyspeck.chatlyio', name: 'Slack' },
      { identifier: 'us.zoom.videomeetings', name: 'Zoom' },
      { identifier: 'com.microsoft.skype.teams', name: 'Microsoft Teams' },
    ]},
  ],
  macos: [
    { label: 'Common browsers', apps: [
      { identifier: 'com.apple.Safari', name: 'Safari' },
      { identifier: 'com.google.Chrome', name: 'Chrome' },
      { identifier: 'org.mozilla.firefox', name: 'Firefox' },
    ]},
    { label: 'Collaboration apps', apps: [
      { identifier: 'com.tinyspeck.slackmacgap', name: 'Slack' },
      { identifier: 'us.zoom.xos', name: 'Zoom' },
      { identifier: 'com.microsoft.teams2', name: 'Microsoft Teams' },
    ]},
  ],
  android: [
    { label: 'Common browsers', apps: [
      { identifier: 'com.android.chrome', name: 'Chrome' },
      { identifier: 'org.mozilla.firefox', name: 'Firefox' },
    ]},
    { label: 'Collaboration apps', apps: [
      { identifier: 'com.slack', name: 'Slack' },
      { identifier: 'us.zoom.videomeetings', name: 'Zoom' },
      { identifier: 'com.microsoft.teams', name: 'Microsoft Teams' },
    ]},
  ],
};

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function AppListForm({ initial, theme, headers, catalog, onCancel, onSaved }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [platform, setPlatform] = useState(initial?.platform || 'apple');
  const [appIds, setAppIds] = useState(initial?.appIds || []);
  const [localCatalog, setLocalCatalog] = useState(catalog); // grows as we add new apps
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [source, setSource] = useState((SOURCES_BY_PLATFORM[initial?.platform || 'apple'] || [])[0]?.id);
  const [manualIdentifier, setManualIdentifier] = useState('');
  const [manualName, setManualName] = useState('');
  const [catalogError, setCatalogError] = useState(null);
  const [saving, setSaving] = useState(false);
  const debouncedText = useDebouncedValue(searchText, 350);
  const reqIdRef = useRef(0);

  const inputCls = "w-full px-2.5 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all";
  const inputStyle = { border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text };
  const sources = SOURCES_BY_PLATFORM[platform] || [];

  // Switching platform invalidates whatever was mid-search — reset source
  // to that platform's default and clear stale results/errors.
  useEffect(() => {
    setSource((SOURCES_BY_PLATFORM[platform] || [])[0]?.id);
    setSearchText('');
    setSearchResults([]);
    setSearchError(null);
  }, [platform]);

  useEffect(() => {
    if (debouncedText.trim().length < 4 || !source) { setSearchResults([]); setSearchError(null); return; }
    const myReq = ++reqIdRef.current;
    setSearching(true);
    setSearchError(null);
    axios.get('/api/app-search', { headers, params: { platform, text: debouncedText.trim(), source } })
      .then(res => {
        if (reqIdRef.current !== myReq) return;
        setSearchResults(res.data?.items || []);
        setSearchError(res.data?.error || null);
      })
      .catch(err => {
        if (reqIdRef.current !== myReq) return;
        setSearchResults([]);
        setSearchError(err.response?.data?.detail || err.message || 'Search failed — see server logs');
      })
      .finally(() => { if (reqIdRef.current === myReq) setSearching(false); });
  }, [debouncedText, platform, source, headers]);

  const catalogForPlatform = localCatalog.filter(e => e.platform === platform);
  const selectedEntries = appIds.map(id => catalogForPlatform.find(e => e.id === id)).filter(Boolean);
  const availableToAdd = catalogForPlatform.filter(e => !appIds.includes(e.id));

  async function addByIdentifier(identifier, appName, iconUrl, srcTag) {
    if (!identifier?.trim()) return;
    setCatalogError(null);
    try {
      const res = await axios.post('/api/app-catalog', { platform, identifier: identifier.trim(), name: appName, iconUrl, source: srcTag }, { headers });
      const entry = res.data;
      setLocalCatalog(prev => (prev.some(e => e.id === entry.id) ? prev : [...prev, entry]));
      setAppIds(prev => (prev.includes(entry.id) ? prev : [...prev, entry.id]));
    } catch (err) {
      setCatalogError(err.response?.data?.detail || err.message || `Could not add "${appName || identifier}"`);
    }
  }

  async function addPreset(preset) {
    setCatalogError(null);
    for (const app of preset.apps) {
      await addByIdentifier(app.identifier, app.name, null, 'preset'); // eslint-disable-line no-await-in-loop
    }
  }

  function removeApp(id) {
    setAppIds(prev => prev.filter(x => x !== id));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSaved({ name: name.trim(), description, platform, appIds });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 rounded-xl border shadow-sm space-y-3" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mandatory security tools" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Platform</label>
          <select
            value={platform}
            disabled={!!initial}
            onChange={e => { setPlatform(e.target.value); setAppIds([]); }}
            className={inputCls}
            style={inputStyle}
          >
            {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Description (optional)</label>
        <input value={description} onChange={e => setDescription(e.target.value)} className={inputCls} style={inputStyle} />
      </div>

      {PRESETS[platform] && (
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Quick-start presets</label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS[platform].map(preset => (
              <button key={preset.label} type="button" onClick={() => addPreset(preset)}
                className="text-[10px] px-2 py-1 rounded-md font-medium"
                style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                + {preset.label}
              </button>
            ))}
          </div>
          {catalogError && (
            <p className="inline-flex items-start gap-1 text-[10px] mt-1.5" style={{ color: DANGER }}>
              <AlertTriangle size={10} className="shrink-0 mt-0.5" /> {catalogError}
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] font-medium" style={{ color: theme.textMuted }}>Search {PLATFORM_LABELS[platform]} apps (4+ characters)</label>
        </div>
        {sources.length > 1 && (
          <div className="flex gap-1.5 mb-1.5">
            {sources.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSource(s.id); setSearchResults([]); setSearchError(null); }}
                className="text-[10px] px-2.5 py-1 rounded-md font-semibold transition-colors"
                style={source === s.id ? { backgroundColor: PRIMARY_BLUE, color: 'white' } : { backgroundColor: theme.bg, border: `1px solid ${theme.border}`, color: theme.textMuted }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: theme.textMuted }} />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={platform === 'android' ? 'App name (already-known Applivery apps only — see note below)' : 'App name…'}
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
        {!searching && !searchError && debouncedText.trim().length >= 4 && searchResults.length === 0 && (
          <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>No matches for "{debouncedText.trim()}" on {sources.find(s => s.id === source)?.label || source}.</p>
        )}
        {searchResults.length > 0 && (
          <div className="mt-1.5 rounded-lg border max-h-40 overflow-y-auto" style={{ borderColor: theme.border }}>
            {searchResults.map(r => (
              <button
                key={`${r.source}:${r.identifier}`}
                type="button"
                onClick={() => addByIdentifier(r.identifier, r.name, r.iconUrl, r.source)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-blue-500/10 text-xs"
                style={{ color: theme.text, borderTop: `1px solid ${theme.border}` }}
              >
                {r.iconUrl ? <img src={r.iconUrl} alt="" className="w-4 h-4 rounded shrink-0" /> : <div className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: theme.bg }} />}
                <span className="truncate flex-1">{r.name}</span>
                <span className="text-[9px] truncate max-w-[35%]" style={{ color: theme.textMuted }}>{r.identifier}</span>
                <Plus size={12} className="shrink-0" style={{ color: PRIMARY_BLUE }} />
              </button>
            ))}
          </div>
        )}
        {platform === 'android' && (
          <p className="inline-flex items-start gap-1 text-[10px] mt-1" style={{ color: theme.textMuted }}>
            <Info size={10} className="shrink-0 mt-0.5" /> No free-text Play Store search exists for EMMs — results above are apps already known to your Applivery org (App Distribution catalog + Android Enterprise). Use manual entry below for anything else.
          </p>
        )}
        {platform === 'windows' && source === 'winget' && (
          <p className="inline-flex items-start gap-1 text-[10px] mt-1" style={{ color: theme.textMuted }}>
            <Info size={10} className="shrink-0 mt-0.5" /> Winget's community index — a convenience suggestion, not authoritative. Double-check a result before relying on it for enforcement.
          </p>
        )}
        {platform === 'macos' && source === 'homebrew' && (
          <p className="inline-flex items-start gap-1 text-[10px] mt-1" style={{ color: theme.textMuted }}>
            <Info size={10} className="shrink-0 mt-0.5" /> Homebrew casks have no bundle-ID field — these are name-only suggestions. Confirm the real bundle ID (e.g. via `mdls -name kMDItemCFBundleIdentifier`) before relying on it.
          </p>
        )}
      </div>

      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Or add manually</label>
        <div className="flex gap-1.5">
          <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Name" className={inputCls} style={inputStyle} />
          <input value={manualIdentifier} onChange={e => setManualIdentifier(e.target.value)} placeholder={platform === 'android' ? 'com.example.app' : platform === 'windows' ? 'App name / product ID' : 'com.example.app'} className={inputCls} style={inputStyle} />
          <button
            type="button"
            disabled={!manualIdentifier.trim()}
            onClick={() => { addByIdentifier(manualIdentifier, manualName || manualIdentifier, null, 'manual'); setManualIdentifier(''); setManualName(''); }}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 disabled:opacity-50 shrink-0 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          >
            Add
          </button>
        </div>
      </div>

      {availableToAdd.length > 0 && (
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Already in your catalog — reuse instead of searching again</label>
          <div className="flex flex-wrap gap-1.5">
            {availableToAdd.map(e => (
              <button key={e.id} type="button" onClick={() => setAppIds(prev => [...prev, e.id])}
                className="text-[10px] px-2 py-1 rounded-md font-medium flex items-center gap-1"
                style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}`, color: theme.text }}>
                <Plus size={10} /> {e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>Apps in this list ({selectedEntries.length})</label>
        {selectedEntries.length === 0 ? (
          <p className="text-[11px]" style={{ color: theme.textMuted }}>No apps added yet.</p>
        ) : (
          <div className="space-y-1">
            {selectedEntries.map(e => (
              <div key={e.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: theme.bg }}>
                <span className="text-xs flex-1 truncate" style={{ color: theme.text }}>{e.name}</span>
                <span className="text-[9px] truncate max-w-[40%]" style={{ color: theme.textMuted }}>{e.identifier}</span>
                <button type="button" onClick={() => removeApp(e.id)} className="p-0.5 rounded shrink-0" style={{ color: DANGER }}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ borderColor: theme.border, color: theme.textMuted }}>Cancel</button>
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={handleSave}
          className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        >
          {initial ? 'Save changes' : 'Create list'}
        </button>
      </div>
    </div>
  );
}

// Installed-app inventory is refreshed in the background by a dedicated
// scheduler (installed_apps_refresher_loop in main.py) — it's the only
// thing that ever calls Applivery's per-device applications endpoint (no
// bulk endpoint exists for this, confirmed against Applivery's API docs),
// paced under its own hourly sub-budget so a large fleet can't crowd out
// every other feature's Applivery traffic. This panel surfaces that
// process — coverage, staleness, budget — so admins aren't guessing
// whether requiredAppList/disallowedAppList conditions actually have data.
function InventoryStatusPanel({ theme, headers }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get('/api/app-lists/installed-apps-status', { headers });
      setStatus(res.data);
      setStatusError(null);
    } catch (err) {
      setStatusError(err.response?.data?.detail || 'Could not load inventory sync status.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers.Authorization, headers['X-Workspace-Slug']]);

  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  async function handleRefreshNow() {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const res = await axios.post('/api/app-lists/refresh-installed-apps', {}, { headers });
      const queued = res.data?.queued || 0;
      setRefreshMessage(queued > 0 ? `Refresh started for ${queued} device(s)…` : 'Nothing to refresh — no devices are in scope of an app-list policy yet.');
      // The refresh runs as a background task server-side; poll status for
      // a little while so the panel updates itself without a manual reload.
      let ticks = 0;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        ticks += 1;
        fetchStatus();
        if (ticks >= 10) clearInterval(pollRef.current);
      }, 3000);
    } catch (err) {
      setRefreshMessage(err.response?.data?.detail || 'Could not start refresh.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveBudget() {
    const parsed = parseInt(budgetDraft, 10);
    if (!parsed || Number.isNaN(parsed)) { setEditingBudget(false); return; }
    setSavingBudget(true);
    try {
      await axios.put('/api/app-lists/installed-apps-budget', { budgetPerHour: parsed }, { headers });
      await fetchStatus();
      setEditingBudget(false);
    } catch (err) {
      alert(err.response?.data?.detail || 'Could not update refresh budget.');
    } finally {
      setSavingBudget(false);
    }
  }

  if (statusError) {
    return (
      <div className="mb-5 px-4 py-3 rounded-lg text-xs flex items-center gap-2 max-w-3xl" style={{ backgroundColor: `${DANGER}12`, color: DANGER }}>
        <AlertTriangle size={13} className="shrink-0" /> {statusError}
      </div>
    );
  }
  if (!status) {
    return <p className="text-xs mb-5" style={{ color: theme.textMuted }}>Loading inventory sync status…</p>;
  }
  if (status.targetDeviceCount === 0) {
    return (
      <div className="mb-5 px-4 py-3 rounded-lg text-xs flex items-center gap-2 max-w-3xl" style={{ backgroundColor: `${theme.textMuted}10`, color: theme.textMuted }}>
        <Info size={13} className="shrink-0" /> No enabled Compliance Policy uses a "Missing a required app" / "Has a disallowed app" condition yet — the installed-app inventory refresher stays idle until one does.
      </div>
    );
  }

  const coveragePct = status.targetDeviceCount ? Math.round((status.syncedCount / status.targetDeviceCount) * 100) : 0;
  const coverageColor = coveragePct >= 90 ? SUCCESS : coveragePct >= 50 ? WARNING : DANGER;

  return (
    <div className="mb-5 p-4 rounded-xl border shadow-sm max-w-3xl" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Gauge size={14} style={{ color: theme.textMuted }} />
          <h3 className="text-xs font-semibold" style={{ color: theme.text }}>Installed-app inventory sync</h3>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={handleRefreshNow}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border disabled:opacity-50"
          style={{ borderColor: theme.border, color: theme.text }}
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> Refresh now
        </button>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-2">
        <div>
          <div className="text-lg font-bold" style={{ color: coverageColor }}>{coveragePct}%</div>
          <div className="text-[10px]" style={{ color: theme.textMuted }}>{status.syncedCount}/{status.targetDeviceCount} devices synced</div>
        </div>
        <div>
          <div className="text-lg font-bold" style={{ color: SUCCESS }}>{status.selfReportedCount || 0}</div>
          <div className="text-[10px]" style={{ color: theme.textMuted }}>self-reported (free)</div>
        </div>
        <div>
          <div className="text-lg font-bold" style={{ color: theme.text }}>{formatAgeMinutes(status.oldestSyncAgeMinutes) || '—'}</div>
          <div className="text-[10px]" style={{ color: theme.textMuted }}>oldest sync age</div>
        </div>
        <div>
          <div className="text-lg font-bold" style={{ color: status.estimatedFullCycleHours > 6 ? WARNING : theme.text }}>{status.estimatedFullCycleHours}h</div>
          <div className="text-[10px]" style={{ color: theme.textMuted }}>est. refresher cycle (excl. self-reported)</div>
        </div>
        <div>
          <div className="text-lg font-bold" style={{ color: theme.text }}>{status.errorCount}</div>
          <div className="text-[10px]" style={{ color: theme.textMuted }}>device(s) with fetch errors</div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${theme.border}` }}>
        <p className="text-[10px] flex items-center gap-1" style={{ color: theme.textMuted }}>
          <Clock size={10} /> Refreshed in the background, stalest devices first — {status.neverSyncedCount > 0 ? `${status.neverSyncedCount} device(s) awaiting first sync.` : 'every target device has synced at least once.'}
        </p>
        {editingBudget ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={budgetDraft}
              onChange={e => setBudgetDraft(e.target.value)}
              min={status.refreshBudgetMin}
              max={status.refreshBudgetMax}
              className="w-20 px-2 py-1 rounded-md text-[11px] outline-none focus:ring-2 focus:ring-brand-500"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            />
            <button type="button" disabled={savingBudget} onClick={handleSaveBudget} className="text-[10px] px-2 py-1 rounded-md font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1">Save</button>
            <button type="button" onClick={() => setEditingBudget(false)} className="text-[10px] px-1.5 py-1" style={{ color: theme.textMuted }}>Cancel</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setBudgetDraft(String(status.refreshBudgetPerHour)); setEditingBudget(true); }}
            className="text-[10px] flex items-center gap-1 hover:opacity-70"
            style={{ color: theme.textMuted }}
          >
            <Pencil size={9} /> Budget: {status.refreshBudgetPerHour} req/hour ({status.refreshBudgetMin}–{status.refreshBudgetMax})
          </button>
        )}
      </div>

      {refreshMessage && <p className="text-[10px] mt-2" style={{ color: theme.textMuted }}>{refreshMessage}</p>}
    </div>
  );
}

export default function AppListsView({ apiToken, orgSlug, theme, onBack }) {
  const [lists, setLists] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [usage, setUsage] = useState({}); // listId -> [{id,name}]
  const [editing, setEditing] = useState(null); // null closed, 'new', or list object
  const [busyId, setBusyId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Critical: this feature calls Applivery-backed endpoints (app-search)
  // that need the real Applivery bearer token, not just the dashboard-auth
  // headers the global axios interceptor injects automatically — that
  // interceptor only covers Authorization-Dashboard/X-Dashboard-Token, so
  // Authorization has to be set explicitly here (same pattern as
  // WorkflowsView/PolicyBuilder).
  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchAll = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setLoadError(null);
    try {
      const [listsRes, catalogRes] = await Promise.all([
        axios.get('/api/app-lists', { headers }),
        axios.get('/api/app-catalog', { headers }),
      ]);
      const items = listsRes.data?.items || [];
      setLists(items);
      setCatalog(catalogRes.data?.items || []);
      const usagePairs = await Promise.all(items.map(l =>
        axios.get(`/api/app-lists/${l.id}/usage`, { headers }).then(r => [l.id, r.data?.items || []]).catch(() => [l.id, []])
      ));
      setUsage(Object.fromEntries(usagePairs));
    } catch (err) {
      setLists([]);
      setLoadError(err.response?.data?.detail || 'Failed to load App Lists.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  useEffect(() => { if (orgSlug) fetchAll(); }, [orgSlug, fetchAll]);

  async function handleCreate(data) {
    await axios.post('/api/app-lists', data, { headers });
    setEditing(null);
    fetchAll();
  }
  async function handleUpdate(id, data) {
    await axios.put(`/api/app-lists/${id}`, data, { headers });
    setEditing(null);
    fetchAll();
  }
  async function handleDelete(list) {
    const refs = usage[list.id] || [];
    if (refs.length > 0) {
      alert(`Can't delete — still referenced by Compliance Policy: ${refs.map(r => r.name).join(', ')}`);
      return;
    }
    if (!confirm(`Delete list "${list.name}"? This cannot be undone.`)) return;
    setBusyId(list.id);
    try {
      await axios.delete(`/api/app-lists/${list.id}`, { headers });
      fetchAll();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-8 pb-16 flex-1 relative overflow-y-auto">
      <header className="flex justify-between items-start mb-8 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold leading-tight" style={{ color: theme.text }}>App Lists</h1>
            <HelpIcon slug="compliance" anchor="app-lists-sub-view" theme={theme} title="App Lists admin guide" />
          </div>
          <p className="text-sm mt-1" style={{ color: theme.textMuted }}>
            Mandatory/disallowed app lists, referenceable from Compliance Policy conditions.
          </p>
        </div>
        <ViewSwitcher
          theme={theme}
          active="appLists"
          onChange={(id) => { if (id === 'policies') onBack(); }}
          className="ml-auto"
          tabs={[
            { id: 'policies', label: 'Policies', Icon: ShieldAlert },
            { id: 'appLists', label: 'App Lists', Icon: ListChecks },
          ]}
        />
      </header>

      <InventoryStatusPanel theme={theme} headers={headers} />

      {loadError && (
        <div className="mb-4 px-4 py-3 rounded-lg text-xs flex items-center gap-2 max-w-3xl" style={{ backgroundColor: `${DANGER}12`, color: DANGER }}>
          <AlertTriangle size={13} className="shrink-0" /> {loadError}
        </div>
      )}

      <div className="space-y-2.5 max-w-3xl">
        {lists === null ? (
          <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
        ) : (
          lists.map(list => {
            if (editing?.id === list.id) {
              return <AppListForm key={list.id} initial={list} theme={theme} headers={headers} catalog={catalog} onCancel={() => setEditing(null)} onSaved={(data) => handleUpdate(list.id, data)} />;
            }
            const refs = usage[list.id] || [];
            return (
              <div key={list.id} className="flex items-center gap-2.5 p-3 rounded-lg border shadow-sm" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold truncate" style={{ color: theme.text }}>{list.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{PLATFORM_LABELS[list.platform] || list.platform}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>{(list.appIds || []).length} apps</span>
                  </div>
                  {list.description && <p className="text-[11px] mt-0.5 truncate" style={{ color: theme.textMuted }}>{list.description}</p>}
                  {refs.length > 0 ? (
                    <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: theme.textMuted }}>
                      <ShieldCheck size={10} /> Used by: {refs.map(r => r.name).join(', ')}
                    </p>
                  ) : (
                    <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>Not referenced by any Compliance Policy yet</p>
                  )}
                </div>
                <button type="button" onClick={() => setEditing(list)} title="Edit" className="p-1.5 rounded-lg hover:bg-blue-500/10 shrink-0" style={{ color: theme.textMuted }}>
                  <Pencil size={13} />
                </button>
                <button type="button" disabled={busyId === list.id} onClick={() => handleDelete(list)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-500/10 shrink-0" style={{ color: DANGER }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}

        {editing === 'new' ? (
          <AppListForm theme={theme} headers={headers} catalog={catalog} onCancel={() => setEditing(null)} onSaved={handleCreate} />
        ) : (
          <button type="button" onClick={() => setEditing('new')} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed text-xs font-medium hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 transition-colors" style={{ borderColor: theme.border, color: theme.textMuted }}>
            <Plus size={13} /> Create App List
          </button>
        )}
      </div>
    </main>
  );
}
