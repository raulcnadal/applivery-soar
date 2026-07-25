import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { DocumentText as ScrollText, Magnifer as Search, Download, ShieldWarning as ShieldAlert, Structure as Workflow, DangerTriangle as AlertTriangle, Settings, Pulse2 as Activity, Calendar, CloseCircle as X, Refresh as RefreshCw, InfoCircle as Info } from '@solar-icons/react';
import HelpIcon from '../shared/HelpIcon';

const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const CATEGORIES = [
  { id: '', label: 'All categories' },
  { id: 'policy', label: 'Policy' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'violation', label: 'Violation' },
  { id: 'settings', label: 'Settings' },
  { id: 'system', label: 'System' },
];

const SEVERITIES = [
  { id: '', label: 'All severities' },
  { id: 'info', label: 'Info' },
  { id: 'warning', label: 'Warning' },
  { id: 'critical', label: 'Critical' },
];

const CATEGORY_META = {
  policy: { Icon: ShieldAlert, color: WARNING },
  workflow: { Icon: Workflow, color: PRIMARY_BLUE },
  violation: { Icon: AlertTriangle, color: DANGER },
  settings: { Icon: Settings, color: PRIMARY_BLUE },
  system: { Icon: Activity, color: SUCCESS },
};

const SEVERITY_META = {
  info: { color: SUCCESS, label: 'Info' },
  warning: { color: WARNING, label: 'Warning' },
  critical: { color: DANGER, label: 'Critical' },
};

const PAGE_SIZE = 50;

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AuditLogsView({ apiToken, orgSlug, theme, initialTargetId, initialTargetLabel, onOpenDevice }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actor, setActor] = useState('');
  const [actorOptions, setActorOptions] = useState([]);
  const [isExporting, setIsExporting] = useState(false);
  // Arrived here from a "View in Audit Log" link (e.g. a device's Active
  // Violations in the Devices detail drawer) — an exact-match filter on
  // targetId, precise in a way a free-text `q` search over a display name
  // wouldn't be (two devices can share a name; ids don't collide). Cleared
  // the same way as any other filter, via the "Clear filters" button.
  const [targetIdFilter, setTargetIdFilter] = useState(initialTargetId || null);
  const [targetLabelFilter, setTargetLabelFilter] = useState(initialTargetLabel || null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  // Debounce free-text search so we're not firing a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildParams = useCallback((offset) => ({
    limit: PAGE_SIZE,
    offset,
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    ...(severity ? { severity } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    ...(targetIdFilter ? { target_id: targetIdFilter } : {}),
    ...(actor ? { actor } : {}),
  }), [q, category, severity, dateFrom, dateTo, targetIdFilter, actor]);

  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/audit-logs/actors', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => setActorOptions(res.data?.items || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  const fetchEntries = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/audit-logs', { headers, params: buildParams(0) });
      setEntries(res.data?.items || []);
      setTotal(res.data?.total || 0);
      setRetentionDays(res.data?.retentionDays ?? null);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load audit logs.');
    } finally {
      setIsLoading(false);
    }
  }, [apiToken, orgSlug, buildParams]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  async function handleLoadMore() {
    setIsLoadingMore(true);
    try {
      const res = await axios.get('/api/audit-logs', { headers, params: buildParams(entries.length) });
      setEntries(prev => [...prev, ...(res.data?.items || [])]);
      setTotal(res.data?.total || 0);
    } catch {
      // non-critical — keep whatever's already loaded
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const res = await axios.get('/api/audit-logs/export', { headers, params: buildParams(0), responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', `audit-log-${orgSlug}-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export audit log.');
    } finally {
      setIsExporting(false);
    }
  }

  const hasFilters = q || category || severity || dateFrom || dateTo || targetIdFilter || actor;

  function clearFilters() {
    setSearchInput(''); setQ(''); setCategory(''); setSeverity(''); setDateFrom(''); setDateTo('');
    setTargetIdFilter(null); setTargetLabelFilter(null); setActor('');
  }

  return (
    <main className="p-8 pb-16 flex-1 relative overflow-y-auto">
      <header className="flex justify-between items-start mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-tight flex items-center gap-2" style={{ color: theme.text }}>
            <ScrollText size={22} style={{ color: PRIMARY_BLUE }} /> Audit Logs
            <HelpIcon slug="audit-logs" theme={theme} title="Audit Logs admin guide" />
          </h1>
          <p className="text-sm mt-1" style={{ color: theme.textMuted }}>
            Every policy evaluation alert and admin action in this workspace{retentionDays !== null ? ` — kept for ${retentionDays > 0 ? `${retentionDays} days` : 'forever'}` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchEntries}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
            style={{ border: `1px solid ${theme.border}`, color: theme.text }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || total === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            <Download size={14} /> {isExporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {targetIdFilter && (
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
            Device: {targetLabelFilter || targetIdFilter}
            <button onClick={() => { setTargetIdFilter(null); setTargetLabelFilter(null); }} className="hover:opacity-70">
              <X size={12} />
            </button>
          </span>
        )}
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by device, policy, workflow, actor…"
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer focus:ring-2 focus:ring-brand-500"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
        >
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer focus:ring-2 focus:ring-brand-500"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
        >
          {SEVERITIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {actorOptions.length > 0 && (
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer focus:ring-2 focus:ring-brand-500 max-w-[160px]"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">All actors</option>
            {actorOptions.map(a => <option key={a} value={a}>{a === 'system' ? 'System' : a}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
          <Calendar size={13} style={{ color: theme.textMuted }} />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm outline-none bg-transparent focus:ring-2 focus:ring-brand-500"
            style={{ color: theme.text, colorScheme: theme.text === '#0B1120' ? 'light' : 'dark' }}
          />
          <span className="text-xs" style={{ color: theme.textMuted }}>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-sm outline-none bg-transparent focus:ring-2 focus:ring-brand-500"
            style={{ color: theme.text, colorScheme: theme.text === '#0B1120' ? 'light' : 'dark' }}
          />
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium" style={{ color: theme.textMuted }}>
            <X size={13} /> Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
          <AlertTriangle size={18} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
          <p className="text-sm" style={{ color: DANGER }}>{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-8 h-8 border-2 rounded-full animate-spin mb-4" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
          <span className="text-xs uppercase tracking-widest font-bold" style={{ color: theme.textMuted }}>Loading audit log…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-xl" style={{ border: `1px dashed ${theme.border}` }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: theme.bg }}>
            <ScrollText size={22} style={{ color: theme.textMuted }} />
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: theme.text }}>
            {hasFilters ? 'No events match these filters' : 'No audit events yet'}
          </p>
          <p className="text-sm max-w-xs" style={{ color: theme.textMuted }}>
            {hasFilters ? 'Try widening the date range or clearing a filter.' : 'Policy evaluations and admin actions will show up here as they happen.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs mb-3" style={{ color: theme.textMuted }}>Showing {entries.length} of {total} event{total === 1 ? '' : 's'}</p>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
            {entries.map((e, i) => {
              const catMeta = CATEGORY_META[e.category] || { Icon: Info, color: theme.textMuted };
              const sevMeta = SEVERITY_META[e.severity] || SEVERITY_META.info;
              const CatIcon = catMeta.Icon;
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-3" style={{ backgroundColor: theme.card, borderTop: i > 0 ? `1px solid ${theme.border}` : 'none' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `${catMeta.color}15`, color: catMeta.color }}>
                    <CatIcon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm" style={{ color: theme.text }}>{e.message}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[11px]" style={{ color: theme.textMuted }}>{formatTimestamp(e.timestamp)}</span>
                      <span className="text-[11px]" style={{ color: theme.textMuted }}>·</span>
                      <span className="text-[11px]" style={{ color: theme.textMuted }}>{e.actor === 'system' ? 'System' : e.actor}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" style={{ backgroundColor: `${sevMeta.color}15`, color: sevMeta.color }}>
                        {sevMeta.label}
                      </span>
                      {e.targetType === 'device' && e.targetId && onOpenDevice && (
                        <>
                          <span className="text-[11px]" style={{ color: theme.textMuted }}>·</span>
                          <button
                            onClick={() => onOpenDevice(e.targetId)}
                            className="text-[11px] font-semibold underline"
                            style={{ color: PRIMARY_BLUE }}
                          >
                            Open {e.targetName || 'device'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {entries.length < total && (
            <div className="flex justify-center mt-4">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ border: `1px solid ${theme.border}`, color: theme.text }}
              >
                {isLoadingMore ? 'Loading…' : `Load more (${total - entries.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
