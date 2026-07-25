import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Refresh as RefreshCw, DangerTriangle as AlertTriangle, ShieldWarning as ShieldAlert } from '@solar-icons/react';

const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const SEVERITY_COLORS = { critical: DANGER, important: '#F97316', moderate: WARNING, low: '#94A3B8' };

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

export default function OsUpdatesSettings({ apiToken, orgSlug, theme }) {
  const [catalog, setCatalog] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchCatalog = useCallback(async () => {
    if (!apiToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/os-updates/catalog', { headers });
      setCatalog(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load the OS update catalog.');
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
      await axios.post('/api/os-updates/refresh', {}, { headers });
      await fetchCatalog();
    } catch (err) {
      setError(err.response?.data?.detail || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  const items = catalog?.items || [];

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-3" style={{ color: theme.textMuted }}>
        Foundation phase, Windows only: a rolling catalog of Microsoft's monthly security updates (sourced from MSRC's public
        CVRF API, refreshed daily) matched against each Windows device's reported OS build to show how many security updates
        it's behind. This is a version-gap signal, not a vulnerability score — cross-referencing pending updates into
        Compliance Policies and risk scoring is a deliberately later phase, not wired up yet.
      </p>
      <p className="text-[11px] leading-relaxed mb-4 px-3 py-2 rounded-lg" style={{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30`, color: theme.textMuted }}>
        Data quality note: Microsoft doesn't always publish a clean, structured "this update produced OS Build X.Y" field —
        we extract it opportunistically from each update's own text. When that succeeds, a device gets a confirmed patch-gap
        count. When it doesn't, the update still appears below for visibility but isn't counted against any device, since a
        guess there would be worse than an honest gap.
      </p>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Scope note: this catalog is Security Updates only — that's everything MSRC's own Security Update Guide tracks.
        Driver updates, Feature updates, and non-security Quality updates aren't in here: Microsoft doesn't publish an
        equivalent structured feed for those, and even if it did, Applivery reports no per-device driver inventory to
        compare against. Every pending item below lists its CVE IDs where available.
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

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: theme.textMuted }}>
          {items.length} known update{items.length === 1 ? '' : 's'} across {(catalog?.monthsFetched || []).length} month{(catalog?.monthsFetched || []).length === 1 ? '' : 's'}
          {catalog?.lastFetchedAt ? ` · last fetched ${timeAgo(catalog.lastFetchedAt)}` : ''}
        </span>
        <button onClick={handleRefresh} disabled={refreshing || isLoading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      {isLoading && items.length === 0 ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>No updates fetched yet — click "Refresh now" to pull the current month from MSRC.</p>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 60).map((e, i) => {
            const sevColor = SEVERITY_COLORS[(e.maxSeverity || '').toLowerCase()] || '#6B7280';
            return (
              <div key={`${e.kb}-${e.buildMajor}-${i}`} className="p-2.5 rounded-xl flex items-center justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="min-w-0 flex items-center gap-2.5">
                  <ShieldAlert size={14} style={{ color: sevColor }} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: theme.text }}>
                      KB{e.kb} <span className="font-normal" style={{ color: theme.textMuted }}>· {e.featureLabel || e.productName}</span>
                    </p>
                    <p className="text-[10px] truncate" style={{ color: theme.textMuted }}>
                      {e.releaseMonth} · {e.cveCount} CVE{e.cveCount === 1 ? '' : 's'}
                      {e.fixedUbr ? ` · build .${e.fixedUbr} (confirmed)` : ' · build unconfirmed'}
                      {e.exploited ? ' · exploited in the wild' : ''}
                    </p>
                    {(e.cveIds || []).length > 0 && (
                      <p className="text-[10px] truncate" style={{ color: theme.textMuted }} title={e.cveIds.join(', ')}>
                        {e.cveIds.slice(0, 4).join(', ')}{e.cveIds.length > 4 ? ` +${e.cveIds.length - 4} more` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${sevColor}15`, color: sevColor }}>
                  {e.maxSeverity || 'Unknown'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
