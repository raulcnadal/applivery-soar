import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Refresh as RefreshCw, DangerTriangle as AlertTriangle, ShieldWarning as ShieldAlert } from '@solar-icons/react';

const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const SEVERITY_COLORS = { critical: DANGER, high: '#F97316', medium: WARNING, low: '#94A3B8' };
const PLATFORM_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'apple', label: 'Apple' },
  { key: 'android', label: 'Android' },
];

function timeAgo(isoString) {
  if (!isoString) return 'never';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function VulnCatalogSettings({ apiToken, orgSlug, theme }) {
  const [catalog, setCatalog] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [platformFilter, setPlatformFilter] = useState('all');

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchCatalog = useCallback(async () => {
    if (!apiToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/vuln-catalog/catalog', { headers });
      setCatalog(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load the vulnerability catalog.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken]);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await axios.post('/api/vuln-catalog/refresh', {}, { headers });
      await fetchCatalog();
    } catch (err) {
      setError(err.response?.data?.detail || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  const items = (catalog?.items || []).filter(e => platformFilter === 'all' || e.platform === platformFilter);

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-3" style={{ color: theme.textMuted }}>
        Foundation phase: a rolling catalog of Apple (iOS/iPadOS, macOS) and Android CVEs, sourced from ENISA's EU
        Vulnerability Database (free, no key, refreshed daily). Apple entries carry a confirmed fixed-version comparison
        against each device's reported OS version. Android's own patch model only exposes major-version granularity here,
        so its comparison is coarser — "a CVE exists that's fixed in a later Android version," not a confirmed monthly
        patch-level gap. Neither is wired into Compliance Policies or risk scoring yet.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {catalog?.lastError && !error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30`, color: WARNING }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {catalog.lastError}
        </div>
      )}

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span className="text-xs" style={{ color: theme.textMuted }}>
          {items.length} entr{items.length === 1 ? 'y' : 'ies'} shown
          {catalog?.lastFetchedAt ? ` · last fetched ${timeAgo(catalog.lastFetchedAt)}` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
            {PLATFORM_FILTERS.map(p => (
              <button
                key={p.key}
                onClick={() => setPlatformFilter(p.key)}
                className="px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  backgroundColor: platformFilter === p.key ? theme.text : 'transparent',
                  color: platformFilter === p.key ? theme.bg : theme.textMuted,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={handleRefresh} disabled={refreshing || isLoading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      </div>

      {isLoading && items.length === 0 ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>No CVEs fetched yet — click "Refresh now" to pull the current window from EUVD.</p>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 80).map((e, i) => {
            const sevColor = SEVERITY_COLORS[(e.baseSeverity || '').toLowerCase()] || '#6B7280';
            return (
              <div key={`${e.cveId}-${e.productLabel}-${i}`} className="p-2.5 rounded-xl flex items-center justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="min-w-0 flex items-center gap-2.5">
                  <ShieldAlert size={14} style={{ color: sevColor }} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: theme.text }}>
                      {e.cveId} <span className="font-normal" style={{ color: theme.textMuted }}>· {e.productLabel}</span>
                    </p>
                    <p className="text-[10px] truncate" style={{ color: theme.textMuted }}>
                      {e.fixedVersion ? `fixed in ${e.fixedVersion}` : (e.androidMajorVersion ? `fixed in Android ${e.androidMajorVersion}` : 'fixed version unconfirmed')}
                      {typeof e.epss === 'number' ? ` · EPSS ${(e.epss * 100).toFixed(0)}%` : ''}
                      {e.exploited ? ' · exploited in the wild' : ''}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${sevColor}15`, color: sevColor }}>
                  {e.baseSeverity || 'Unknown'}{typeof e.baseScore === 'number' ? ` ${e.baseScore.toFixed(1)}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
