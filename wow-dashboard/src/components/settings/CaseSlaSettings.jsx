import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { DangerTriangle as AlertTriangle } from '@solar-icons/react';

const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const SEVERITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const SEVERITY_COLORS = { low: '#94A3B8', medium: WARNING, high: '#F97316', critical: DANGER };

function minutesToFriendly(mins) {
  const n = Number(mins) || 0;
  if (n < 60) return `${n}m`;
  if (n < 1440) return `${(n / 60).toFixed(n % 60 ? 1 : 0)}h`;
  return `${(n / 1440).toFixed(n % 1440 ? 1 : 0)}d`;
}

function Field({ label, hint, theme, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
      {hint && <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>{hint}</p>}
    </div>
  );
}

export default function CaseSlaSettings({ apiToken, orgSlug, theme }) {
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchSettings = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/case-sla-settings', { headers });
      setSettings(res.data);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load Case SLA settings.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  function setThreshold(sev, field, value) {
    setSettings(s => ({
      ...s,
      thresholds: { ...s.thresholds, [sev]: { ...s.thresholds[sev], [field]: value === '' ? '' : Number(value) } },
    }));
    setDirty(true);
  }

  function toggle(field, value) {
    setSettings(s => ({ ...s, [field]: value }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await axios.put('/api/case-sla-settings', settings, { headers });
      setSettings(res.data);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save Case SLA settings.');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !settings) {
    return <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>;
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Two clocks per Case, both starting the moment it opens (or reopens): acknowledge — stops the first time it gets an assignee or moves to Investigating — and resolve — stops when it's closed, resolved, or marked a false positive. Breaching either fires a critical Audit Log entry and, if enabled below, a one-time chat notification to any Slack/Teams/Discord/generic webhook integration configured under Ticketing &amp; Chat (never a duplicate Jira/ServiceNow ticket).
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex items-center gap-6 mb-4">
        <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.text }}>
          <input type="checkbox" checked={settings.enabled} onChange={(e) => toggle('enabled', e.target.checked)} /> SLA tracking enabled
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.text }}>
          <input type="checkbox" checked={settings.notifyOnBreach} onChange={(e) => toggle('notifyOnBreach', e.target.checked)} /> Notify chat integrations on breach
        </label>
      </div>

      <div className="space-y-2">
        {SEVERITIES.map(sev => {
          const t = settings.thresholds[sev] || {};
          return (
            <div key={sev} className="p-3 rounded-xl grid grid-cols-3 items-end gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SEVERITY_COLORS[sev] }} />
                <span className="text-sm font-semibold" style={{ color: theme.text }}>{SEVERITY_LABELS[sev]}</span>
              </div>
              <Field label="Acknowledge within (minutes)" theme={theme} hint={`≈ ${minutesToFriendly(t.acknowledgeMinutes)}`}>
                <input type="number" min={1} value={t.acknowledgeMinutes ?? ''} onChange={(e) => setThreshold(sev, 'acknowledgeMinutes', e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                  style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }} />
              </Field>
              <Field label="Resolve within (minutes)" theme={theme} hint={`≈ ${minutesToFriendly(t.resolveMinutes)}`}>
                <input type="number" min={1} value={t.resolveMinutes ?? ''} onChange={(e) => setThreshold(sev, 'resolveMinutes', e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                  style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }} />
              </Field>
            </div>
          );
        })}
      </div>

      {dirty && (
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={fetchSettings} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Discard</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}
