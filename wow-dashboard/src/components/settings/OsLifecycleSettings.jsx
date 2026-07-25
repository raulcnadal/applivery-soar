import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Refresh as RefreshCw, DangerTriangle as AlertTriangle, CheckCircle as CheckCircle2, CloseCircle as XCircle } from '@solar-icons/react';

const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const PLATFORM_LABELS = { windows: 'Windows', apple: 'iOS / iPadOS', macos: 'macOS', android: 'Android' };
const PLATFORM_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'windows', label: 'Windows' },
  { key: 'apple', label: 'iOS' },
  { key: 'macos', label: 'macOS' },
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

export default function OsLifecycleSettings({ apiToken, orgSlug, theme }) {
  const [catalog, setCatalog] = useState(null);
  const [gdmf, setGdmf] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [gdmfRefreshing, setGdmfRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [platformFilter, setPlatformFilter] = useState('all');

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchCatalog = useCallback(async () => {
    if (!apiToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const [lifecycleRes, gdmfRes] = await Promise.all([
        axios.get('/api/os-lifecycle/catalog', { headers }),
        axios.get('/api/gdmf/catalog', { headers }),
      ]);
      setCatalog(lifecycleRes.data);
      setGdmf(gdmfRes.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load the OS lifecycle catalog.');
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
      await axios.post('/api/os-lifecycle/refresh', {}, { headers });
      await fetchCatalog();
    } catch (err) {
      setError(err.response?.data?.detail || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleGdmfRefresh() {
    setGdmfRefreshing(true);
    setError(null);
    try {
      await axios.post('/api/gdmf/refresh', {}, { headers });
      await fetchCatalog();
    } catch (err) {
      setError(err.response?.data?.detail || 'GDMF refresh failed.');
    } finally {
      setGdmfRefreshing(false);
    }
  }

  const gdmfPlatforms = gdmf?.platforms || {};
  const gdmfRows = Object.entries(gdmfPlatforms)
    .filter(([plat]) => platformFilter === 'all' || platformFilter === plat)
    .flatMap(([plat, entries]) => entries.map(e => ({ ...e, platform: plat })))
    .filter(e => !e.isExpired)
    .sort((a, b) => (b.postingDate || '').localeCompare(a.postingDate || ''));

  const rsrPlatforms = gdmf?.rapidSecurityResponses || {};
  const rsrRows = Object.entries(rsrPlatforms)
    .filter(([plat]) => platformFilter === 'all' || platformFilter === plat)
    .flatMap(([plat, entries]) => entries.map(e => ({ ...e, platform: plat })))
    .filter(e => !e.isExpired)
    .sort((a, b) => (b.postingDate || '').localeCompare(a.postingDate || ''));

  const platforms = catalog?.platforms || {};
  const rows = Object.entries(platforms)
    .filter(([plat]) => platformFilter === 'all' || plat === platformFilter)
    .flatMap(([plat, releases]) => releases.map(r => ({ ...r, platform: plat })))
    .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Foundation phase: end-of-life / active-support status for every major Windows, iOS/iPadOS, macOS, and Android
        version, sourced from endoflife.date (free, no key, refreshed weekly). This is the one signal MSRC and the
        Vulnerability Catalog can't give — a device with zero pending CVEs may simply be on a version nobody's filed a
        CVE against yet, not necessarily a current one. Windows editions with different support windows (Enterprise/IoT
        vs. consumer) are conservatively only flagged end-of-life once every edition sharing that build has lapsed.
      </p>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        For iOS/iPadOS and macOS, Apple's own Software Lookup Service (GDMF — the source Declarative Device Management
        now expects UEMs to use) sharpens this further: an exact build number per version and a cryptographic-signing
        expiration date, refreshed daily per Apple's own polling guidance. When a device's hardware model can be
        confirmed against a release's supported-device list, "latest available" reflects that specific hardware;
        otherwise it falls back to the newest still-signed release fleet-wide, labeled unconfirmed rather than assumed.
        The same GDMF response also carries active Rapid Security Responses — the small "(a)"/"(b)"-suffixed patches
        Apple ships between full point releases — which we surface separately below and on each device, since an RSR
        isn't a normal version bump and can't be compared like one.
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
          {rows.length} train{rows.length === 1 ? '' : 's'} shown
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

      {isLoading && rows.length === 0 ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>No lifecycle data fetched yet — click "Refresh now" to pull from endoflife.date.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.slice(0, 80).map((r, i) => {
            const eol = r.isEol;
            const Icon = eol ? XCircle : (r.isMaintained ? CheckCircle2 : AlertTriangle);
            const color = eol ? DANGER : (r.isMaintained ? SUCCESS : WARNING);
            return (
              <div key={`${r.platform}-${r.name}-${i}`} className="p-2.5 rounded-xl flex items-center justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="min-w-0 flex items-center gap-2.5">
                  <Icon size={14} style={{ color }} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: theme.text }}>
                      {PLATFORM_LABELS[r.platform] || r.platform} <span className="font-normal" style={{ color: theme.textMuted }}>· {r.label || r.name}</span>
                    </p>
                    <p className="text-[10px] truncate" style={{ color: theme.textMuted }}>
                      latest {r.latestVersion || 'unknown'}{r.latestDate ? ` (${r.latestDate})` : ''}
                      {eol && r.eolFrom ? ` · EOL since ${r.eolFrom}` : ''}
                      {r.esuUntil ? ` · ESU until ${r.esuUntil}` : ''}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${color}15`, color }}>
                  {eol ? 'End of life' : (r.isMaintained ? 'Supported' : 'Unknown')}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {(platformFilter === 'all' || platformFilter === 'apple' || platformFilter === 'macos') && (
        <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${theme.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold" style={{ color: theme.text }}>
              Apple Software Lookup Service (GDMF) — currently-signed releases
            </p>
            <button onClick={handleGdmfRefresh} disabled={gdmfRefreshing || isLoading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
              <RefreshCw size={12} className={gdmfRefreshing ? 'animate-spin' : ''} /> {gdmfRefreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
          {gdmf?.lastError && (
            <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30`, color: WARNING }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {gdmf.lastError}
            </div>
          )}
          <p className="text-[10px] mb-2" style={{ color: theme.textMuted }}>
            {gdmfRows.length} currently-signed release{gdmfRows.length === 1 ? '' : 's'}
            {gdmf?.lastFetchedAt ? ` · last fetched ${timeAgo(gdmf.lastFetchedAt)}` : ' · not fetched yet'}
          </p>
          {gdmfRows.length === 0 ? (
            <p className="text-xs" style={{ color: theme.textMuted }}>No GDMF data fetched yet — click "Refresh now" to pull from Apple.</p>
          ) : (
            <div className="space-y-1.5">
              {gdmfRows.slice(0, 40).map((e, i) => (
                <div key={`${e.platform}-${e.build}-${i}`} className="p-2.5 rounded-xl flex items-center justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: theme.text }}>
                      {PLATFORM_LABELS[e.platform] || e.platform} {e.productVersion} <span className="font-normal font-mono" style={{ color: theme.textMuted }}>({e.build})</span>
                    </p>
                    <p className="text-[10px] truncate" style={{ color: theme.textMuted }}>
                      posted {e.postingDate || 'unknown'} · signed until {e.expirationDate || 'unknown'} · {(e.supportedDevices || []).length} hardware model{(e.supportedDevices || []).length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }}>
                    Signed
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mb-3 mt-5">
            <p className="text-xs font-semibold" style={{ color: theme.text }}>
              Rapid Security Responses — active
            </p>
          </div>
          <p className="text-[10px] mb-2" style={{ color: theme.textMuted }}>
            {rsrRows.length} active RSR{rsrRows.length === 1 ? '' : 's'}
            {gdmf?.lastFetchedAt ? ` · last fetched ${timeAgo(gdmf.lastFetchedAt)}` : ' · not fetched yet'}
            {' · schema unverified against a live Apple response — sanity-check against the first production refresh'}
          </p>
          {rsrRows.length === 0 ? (
            <p className="text-xs" style={{ color: theme.textMuted }}>
              No active Rapid Security Response found for the current filter — either none is currently signed, or GDMF hasn't returned RSR data yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {rsrRows.slice(0, 40).map((e, i) => (
                <div key={`${e.platform}-rsr-${e.build}-${i}`} className="p-2.5 rounded-xl flex items-center justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: theme.text }}>
                      {PLATFORM_LABELS[e.platform] || e.platform} {e.productVersion}
                      {e.supplementalBuildVersion ? <span className="font-normal" style={{ color: theme.textMuted }}> ({e.supplementalBuildVersion})</span> : null}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: theme.textMuted }}>
                      posted {e.postingDate || 'unknown'} · signed until {e.expirationDate || 'unknown'}
                      {(e.cveIds || []).length > 0 ? ` · ${e.cveIds.slice(0, 3).join(', ')}${e.cveIds.length > 3 ? ` +${e.cveIds.length - 3} more` : ''}` : ''}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>
                    RSR
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
