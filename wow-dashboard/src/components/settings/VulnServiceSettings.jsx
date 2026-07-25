import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Refresh as RefreshCw, DangerTriangle as AlertTriangle, CheckCircle as Check,
  PlugCircle as Plug, ShieldWarning as ShieldAlert,
} from '@solar-icons/react';

const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';
const PRIMARY_BLUE = '#0241E3';

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

function Field({ label, theme, children, hint }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
      {hint && <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>{hint}</p>}
    </div>
  );
}

function inputCls(theme) {
  return { border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text };
}

// Applivery's self-hosted vulnerability-detection CloudFlare Worker: an
// NVD-derived CVE database enriched with CISA KEV + FIRST EPSS, queried per
// {identifier, version, platform} for installed apps and per {platform,
// os_version} for the OS itself. Deliberately opt-in and per-workspace
// (unlike the always-on, global EUVD-based Vulnerability Catalog elsewhere
// in Settings) — an admin points this at their own instance and both
// sources then run side by side as independent signals on the same device.
export default function VulnServiceSettings({ apiToken, orgSlug, theme, canManage }) {
  const [config, setConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState(null); // null | 'ok'
  const [testState, setTestState] = useState(null); // null | 'testing' | 'ok' | <error string>

  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiTokenValue, setApiTokenValue] = useState('');
  const [refreshIntervalHours, setRefreshIntervalHours] = useState(6);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchConfig = useCallback(async () => {
    if (!apiToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/vuln-service/config', { headers });
      setConfig(res.data);
      setEnabled(!!res.data.enabled);
      setBaseUrl(res.data.baseUrl || '');
      // apiToken is redacted server-side to {set, last4} — never the real
      // value, so the field always starts blank. Leaving it blank on save
      // keeps whatever's already stored; only a non-blank entry replaces it.
      setApiTokenValue('');
      setRefreshIntervalHours(res.data.refreshIntervalHours || 6);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load the Vulnerability Service configuration.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaveState(null);
    try {
      const res = await axios.put('/api/vuln-service/config', {
        enabled, baseUrl: baseUrl.trim(), apiToken: apiTokenValue, refreshIntervalHours: Number(refreshIntervalHours) || 6,
      }, { headers });
      setConfig(res.data);
      setApiTokenValue(''); // form never holds the real secret past a successful save
      setSaveState('ok');
      setTimeout(() => setSaveState(null), 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestState('testing');
    setError(null);
    try {
      const res = await axios.post('/api/vuln-service/test', {
        enabled, baseUrl: baseUrl.trim(), apiToken: apiTokenValue, refreshIntervalHours: Number(refreshIntervalHours) || 6,
      }, { headers });
      setTestState(`ok:${res.data.latencyMs}`);
    } catch (err) {
      setTestState(err.response?.data?.detail || 'Test failed.');
    } finally {
      setTimeout(() => setTestState(null), 6000);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await axios.post('/api/vuln-service/refresh', {}, { headers });
      await fetchConfig();
    } catch (err) {
      setError(err.response?.data?.detail || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  const stats = config?.lastRefreshStats;
  const disabledTitle = !canManage ? "Your role isn't permitted to edit Integrations secrets." : undefined;

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-3" style={{ color: theme.textMuted }}>
        Connects to an Applivery-hosted Vulnerability Service instance (a self-hosted CloudFlare Worker your org runs) for
        richer CVE matching than the built-in Vulnerability Catalog: all four platforms including Windows, both the OS and
        individual installed apps, confirmed fix versions, and CISA KEV / FIRST EPSS prioritization. This runs alongside the
        Vulnerability Catalog as an independent, opt-in signal — not a replacement for it.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {config?.lastRefreshError && !error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30`, color: WARNING }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {config.lastRefreshError}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="p-4 rounded-xl mb-3 space-y-3" style={{ border: `1px solid ${PRIMARY_BLUE}40`, backgroundColor: theme.bg }}>
          <label className="flex items-center gap-2 text-xs font-medium" style={{ color: theme.text }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canManage} /> Enabled
          </label>

          <Field label="Service base URL" theme={theme} hint="The Worker's deployed URL, e.g. https://vuln.yourorg.workers.dev — no trailing slash.">
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://vuln.yourorg.workers.dev" disabled={!canManage}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60" style={inputCls(theme)} />
          </Field>

          <Field
            label="API token"
            theme={theme}
            hint={config?.apiToken?.set
              ? `A token is already saved (••••${config.apiToken.last4}). Leave blank to keep it, or enter a new one to replace it.`
              : 'Bearer token configured on the Worker (API_TOKEN). Never shown again after saving.'}
          >
            <input type="password" value={apiTokenValue} onChange={(e) => setApiTokenValue(e.target.value)}
              placeholder={config?.apiToken?.set ? `•••• ${config.apiToken.last4} (unchanged)` : '••••••••'} disabled={!canManage}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60" style={inputCls(theme)} />
          </Field>

          <Field label="Refresh interval (hours)" theme={theme} hint="How often the background job re-checks new or changed installs. 1–72 hours.">
            <input type="number" min={1} max={72} value={refreshIntervalHours} onChange={(e) => setRefreshIntervalHours(e.target.value)} disabled={!canManage}
              className="w-32 px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60" style={inputCls(theme)} />
          </Field>

          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={!canManage || saving} title={disabledTitle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: PRIMARY_BLUE }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={handleTest} disabled={!canManage || testState === 'testing' || !baseUrl || (!apiTokenValue && !config?.apiToken?.set)} title={disabledTitle}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
              <Plug size={12} /> {testState === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {saveState === 'ok' && <span className="text-[10px] flex items-center gap-1" style={{ color: SUCCESS }}><Check size={11} /> Saved</span>}
            {testState && testState !== 'testing' && testState.startsWith('ok:') && (
              <span className="text-[10px] flex items-center gap-1" style={{ color: SUCCESS }}><Check size={11} /> Reachable ({testState.split(':')[1]}ms)</span>
            )}
            {testState && testState !== 'testing' && !testState.startsWith('ok:') && (
              <span className="text-[10px]" style={{ color: DANGER }}>{testState}</span>
            )}
          </div>
        </form>
      )}

      {config?.enabled && (
        <div className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: theme.text }}>
              <ShieldAlert size={13} style={{ color: PRIMARY_BLUE }} /> Refresh status
            </span>
            <button onClick={handleRefresh} disabled={refreshing} title={!canManage ? "Your role isn't permitted to trigger a refresh." : undefined}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
          <p className="text-[11px]" style={{ color: theme.textMuted }}>
            Last refreshed {timeAgo(config.lastRefreshAt)}
          </p>
          {stats && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="text-[10px]" style={{ color: theme.textMuted }}>
                OS checks: {stats.osQueried} queried{stats.osErrors ? `, ${stats.osErrors} failed` : ''} / {stats.osTotal} distinct combos
              </div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>
                App checks: {stats.appsQueried} queried{stats.appsErrors ? `, ${stats.appsErrors} failed` : ''} / {stats.appsTotal} distinct combos
                {stats.appsRemaining ? ` (${stats.appsRemaining} remaining, next tick)` : ''}
              </div>
              {stats.cacheEvicted > 0 && (
                <div className="text-[10px] col-span-2" style={{ color: theme.textMuted }}>
                  Cache: {stats.cacheEvicted} stale entr{stats.cacheEvicted === 1 ? 'y' : 'ies'} evicted (app uninstalled or OS version changed)
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
