import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, DangerTriangle as AlertTriangle,
  CheckCircle as Check, TestTube,
} from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const SUCCESS = '#22C55E';

const TYPE_META = {
  virustotal: { label: 'VirusTotal', hint: 'API key from your VirusTotal account (Settings → API Key). Supports IPs, domains, URLs, and file hashes (MD5/SHA1/SHA256).' },
  abuseipdb: { label: 'AbuseIPDB', hint: 'API key from your AbuseIPDB account. IP addresses only.' },
  hibp: { label: 'Have I Been Pwned', hint: 'Paid API key from haveibeenpwned.com/API/Key — there\'s no free tier for breach search. Email addresses only: checks whether an email has appeared in a known data breach, and flags it more severely if a password was exposed alongside it.' },
  generic_rest: { label: 'Generic REST', hint: 'A GET request template for any other threat intel API. Use {{ ioc }} where the looked-up value should go. The raw response is shown as-is — there\'s no generic way to parse an arbitrary API\'s verdict.' },
};

const TEST_IOC_LABEL = {
  virustotal: 'Test lookup against 8.8.8.8', abuseipdb: 'Test lookup against 8.8.8.8',
  hibp: 'Test lookup against HIBP\'s official test account', generic_rest: 'Test lookup against 8.8.8.8',
};

function inputCls(theme) {
  return { border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text };
}

function Field({ label, theme, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
    </div>
  );
}

function ProviderForm({ initial, theme, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'virustotal');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [config, setConfig] = useState(initial?.config || {});
  const [saving, setSaving] = useState(false);

  function setCfg(key, value) {
    setConfig(c => ({ ...c, [key]: value }));
  }
  function handleTypeChange(t) {
    setType(t);
    if (!initial) setConfig({});
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), type, enabled, config });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 rounded-xl mb-3 space-y-3" style={{ border: `1px solid ${PRIMARY_BLUE}40`, backgroundColor: theme.bg }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" theme={theme}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VirusTotal"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
        <Field label="Type" theme={theme}>
          <select value={type} onChange={(e) => handleTypeChange(e.target.value)} disabled={!!initial}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60" style={inputCls(theme)}>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-[10px]" style={{ color: theme.textMuted }}>{TYPE_META[type].hint}</p>

      {(type === 'virustotal' || type === 'abuseipdb' || type === 'hibp') && (
        <Field label="API key" theme={theme}>
          <input type="password" value={config.apiKey || ''} onChange={(e) => setCfg('apiKey', e.target.value)} placeholder="API key"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
        </Field>
      )}

      {type === 'generic_rest' && (
        <>
          <Field label="URL template" theme={theme}>
            <input value={config.urlTemplate || ''} onChange={(e) => setCfg('urlTemplate', e.target.value)} placeholder="https://api.example.com/lookup?q={{ ioc }}"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)} />
          </Field>
          <Field label="Header (optional, e.g. API key)" theme={theme}>
            <input
              value={Object.keys(config.headers || {})[0] ? `${Object.keys(config.headers)[0]}: ${Object.values(config.headers)[0]}` : ''}
              onChange={(e) => {
                const [k, ...rest] = e.target.value.split(':');
                setCfg('headers', k?.trim() ? { [k.trim()]: rest.join(':').trim() } : {});
              }}
              placeholder="X-API-Key: your-key-here"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" style={inputCls(theme)}
            />
          </Field>
        </>
      )}

      <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create provider')}
        </button>
      </div>
    </form>
  );
}

export default function ThreatIntelSettings({ orgSlug, theme, canManage = true }) {
  const [providers, setProviders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = edit
  const [testState, setTestState] = useState({}); // { [id]: 'testing' | 'ok' | error message }

  const headers = { 'X-Workspace-Slug': orgSlug };

  const fetchAll = useCallback(async () => {
    if (!orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/threat-intel/providers', { headers });
      setProviders(res.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load threat intel providers.');
    } finally {
      setIsLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSave(data) {
    if (editing && editing.id) {
      await axios.put(`/api/threat-intel/providers/${editing.id}`, data, { headers });
    } else {
      await axios.post('/api/threat-intel/providers', data, { headers });
    }
    setEditing(undefined);
    fetchAll();
  }

  async function handleDelete(provider) {
    if (!window.confirm(`Delete provider "${provider.name}"?`)) return;
    await axios.delete(`/api/threat-intel/providers/${provider.id}`, { headers });
    fetchAll();
  }

  async function handleTest(provider) {
    setTestState(s => ({ ...s, [provider.id]: 'testing' }));
    try {
      await axios.post(`/api/threat-intel/providers/${provider.id}/test`, {}, { headers });
      setTestState(s => ({ ...s, [provider.id]: 'ok' }));
    } catch (err) {
      setTestState(s => ({ ...s, [provider.id]: err.response?.data?.detail || 'Test failed' }));
    } finally {
      setTimeout(() => setTestState(s => ({ ...s, [provider.id]: undefined })), 4000);
    }
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Lets an analyst working a Case look up an IOC (IP, domain, URL, file hash, or email address) against these providers from the Case detail panel — a manual "Enrich" action, not an automatic scan. Devices in this app don't carry network-flow or process telemetry to auto-scan against, so IOCs come from wherever the analyst found them (a log, a report, an installed-app identifier, a device's MDM user email) and get checked against every enabled provider that supports that IOC type.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {editing !== undefined && (
        <ProviderForm initial={editing} theme={theme} onCancel={() => setEditing(undefined)} onSave={handleSave} />
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : providers.length === 0 && editing === undefined ? (
        <p className="text-xs mb-3" style={{ color: theme.textMuted }}>No threat intel providers configured yet.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {providers.map(provider => {
            const meta = TYPE_META[provider.type] || { label: provider.type };
            const state = testState[provider.id];
            return (
              <div key={provider.id} className="p-3 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{provider.name}</p>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>{meta.label}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: provider.enabled ? `${SUCCESS}15` : `${theme.textMuted}15`, color: provider.enabled ? SUCCESS : theme.textMuted }}>
                      {provider.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleTest(provider)} disabled={state === 'testing' || !canManage} title={!canManage ? "Your role isn't permitted to test Threat Intel providers." : (TEST_IOC_LABEL[provider.type] || 'Test lookup')} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: theme.textMuted }}><TestTube size={13} /></button>
                    <button onClick={() => setEditing(provider)} disabled={!canManage} title={!canManage ? "Your role isn't permitted to edit Threat Intel providers." : "Edit"} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: theme.textMuted }}><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(provider)} disabled={!canManage} title={!canManage ? "Your role isn't permitted to delete Threat Intel providers." : "Delete"} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: DANGER }}><Trash2 size={13} /></button>
                  </div>
                </div>
                {state === 'testing' && <p className="text-[10px]" style={{ color: theme.textMuted }}>Testing…</p>}
                {state === 'ok' && <p className="text-[10px] flex items-center gap-1" style={{ color: SUCCESS }}><Check size={11} /> Test succeeded</p>}
                {state && state !== 'testing' && state !== 'ok' && <p className="text-[10px]" style={{ color: DANGER }}>{state}</p>}
              </div>
            );
          })}
        </div>
      )}

      {editing === undefined && canManage && (
        <button onClick={() => setEditing(null)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700">
          <Plus size={14} /> New Provider
        </button>
      )}
    </div>
  );
}
