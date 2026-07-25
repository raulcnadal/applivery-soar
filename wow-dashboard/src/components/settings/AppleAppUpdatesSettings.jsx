import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Refresh as RefreshCw, DangerTriangle as AlertTriangle } from '@solar-icons/react';

const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';
const DANGER = '#EF4444';

export default function AppleAppUpdatesSettings({ apiToken, orgSlug, theme }) {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [queuedMsg, setQueuedMsg] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchStatus = useCallback(async () => {
    if (!apiToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/apple-app-updates/status', { headers });
      setStatus(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load Apple app-update coverage.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    setQueuedMsg(null);
    try {
      const res = await axios.post('/api/apple-app-updates/refresh', {}, { headers });
      setQueuedMsg(`Queued a live refresh for ${res.data?.queued ?? 0} device(s) — this runs in the background, re-check in a minute.`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-3" style={{ color: theme.textMuted }}>
        Pending app updates for every Apple/macOS device, sourced straight from Applivery's per-device applications
        endpoint (<code>HasUpdateAvailable</code>) — this is Apple's own App Store/VPP metadata, not a version
        catalog we maintain, so it's exact rather than a best-effort comparison.
      </p>
      <p className="text-[11px] leading-relaxed mb-4 px-3 py-2 rounded-lg" style={{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30`, color: theme.textMuted }}>
        Windows and Android don't have an equivalent field in Applivery's API — those platforms report installed
        app name and version, but Applivery itself doesn't compute "is this outdated" for them, so pending-app-update
        tracking here is Apple-only.
      </p>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        This is a per-device Applivery API call (unlike the fleet-aggregate OS-update endpoint), so coverage rolls
        in gradually under a rate-limited background refresher shared with App List compliance — see the numbers
        below for how current the data is right now.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {queuedMsg && (
        <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${SUCCESS}10`, border: `1px solid ${SUCCESS}30`, color: SUCCESS }}>
          {queuedMsg}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: theme.textMuted }}>
          {isLoading && !status ? 'Loading…' : status ? `${status.targetDeviceCount} Apple device${status.targetDeviceCount === 1 ? '' : 's'} tracked` : ''}
        </span>
        <button onClick={handleRefresh} disabled={refreshing || isLoading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Queuing…' : 'Refresh now'}
        </button>
      </div>

      {status && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
              <p className="text-[10px]" style={{ color: theme.textMuted }}>Devices with pending updates</p>
              <p className="text-lg font-bold" style={{ color: status.devicesWithPendingUpdates > 0 ? WARNING : SUCCESS }}>{status.devicesWithPendingUpdates}</p>
            </div>
            <div className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
              <p className="text-[10px]" style={{ color: theme.textMuted }}>Pending app instances (fleet-wide)</p>
              <p className="text-lg font-bold" style={{ color: theme.text }}>{status.totalPendingAppInstances}</p>
            </div>
            <div className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
              <p className="text-[10px]" style={{ color: theme.textMuted }}>Synced / never synced</p>
              <p className="text-lg font-bold" style={{ color: theme.text }}>{status.syncedCount} <span className="text-xs font-normal" style={{ color: theme.textMuted }}>/ {status.neverSyncedCount}</span></p>
            </div>
            <div className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
              <p className="text-[10px]" style={{ color: theme.textMuted }}>Estimated full cycle</p>
              <p className="text-lg font-bold" style={{ color: theme.text }}>{status.estimatedFullCycleHours ? `${status.estimatedFullCycleHours}h` : '—'}</p>
            </div>
          </div>

          <p className="text-[10px] mb-2" style={{ color: theme.textMuted }}>
            {status.errorCount > 0 ? `${status.errorCount} device(s) errored on last fetch · ` : ''}
            {status.medianSyncAgeMinutes != null ? `median sync age ${Math.round(status.medianSyncAgeMinutes)}m` : 'no sync data yet'}
            {status.refreshBudgetPerHour ? ` · budget ${status.refreshBudgetPerHour}/hr (shared with App List compliance)` : ''}
          </p>

          {status.topPendingApps?.length > 0 ? (
            <div className="space-y-1.5 mt-3">
              <p className="text-xs font-semibold" style={{ color: theme.text }}>Most common apps with an update available</p>
              {status.topPendingApps.map((a) => (
                <div key={a.name} className="p-2.5 rounded-xl flex items-center justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                  <span className="text-xs truncate" style={{ color: theme.text }}>{a.name}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>
                    {a.deviceCount} device{a.deviceCount === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          ) : status.syncedCount > 0 ? (
            <p className="text-xs mt-3" style={{ color: SUCCESS }}>No pending app updates found on any synced Apple device.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
