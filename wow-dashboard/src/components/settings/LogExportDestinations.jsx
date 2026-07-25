import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AddSquare as Plus, TrashBinMinimalistic as Trash2, Pen2 as Pencil, Power, TestTube, Radio, PlugCircle as Webhook, Cloud, ServerSquare as HardDrive, Server, CheckCircle as Check, DangerTriangle as AlertTriangle } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const SUCCESS = '#22C55E';

// realtime: fired inline as each audit event is written (syslog/webhook).
// Everything else is a once-a-day batch export — see log_export_scheduler_loop in main.py.
const TYPE_META = {
  syslog:  { label: 'Syslog',  Icon: Radio,     realtime: true,  hint: 'Streams each event as it happens (RFC 5424 over UDP) — what most SIEMs (Splunk, QRadar, Elastic, Sentinel) listen for.' },
  webhook: { label: 'Webhook', Icon: Webhook,   realtime: true,  hint: 'POSTs a JSON batch to a URL as events happen.' },
  s3:      { label: 'S3',      Icon: Cloud,     realtime: false, hint: 'Once-a-day JSON export to an S3 (or S3-compatible) bucket.' },
  nfs:     { label: 'NFS / Filesystem', Icon: HardDrive, realtime: false, hint: 'Once-a-day JSON export to a local/mounted directory.' },
  sftp:    { label: 'SFTP',    Icon: Server,    realtime: false, hint: 'Once-a-day JSON export over SFTP.' },
};

function defaultConfigForType(type) {
  switch (type) {
    case 'syslog': return { host: '', port: 514, facility: 16 };
    case 'webhook': return { url: '', authHeaderValue: '' };
    case 's3': return { bucket: '', region: '', prefix: 'audit-logs/', accessKeyId: '', secretAccessKey: '', endpointUrl: '' };
    case 'nfs': return { path: '' };
    case 'sftp': return { host: '', port: 22, username: '', password: '', privateKey: '', remotePath: '/' };
    default: return {};
  }
}

function Field({ label, theme, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: theme.textMuted }}>{label}</label>
      {children}
    </div>
  );
}

function DestinationForm({ initial, theme, onCancel, onSave }) {
  const [type, setType] = useState(initial?.type || 'syslog');
  const [name, setName] = useState(initial?.name || '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [format, setFormat] = useState(initial?.format || 'json');
  const [config, setConfig] = useState(initial?.config || defaultConfigForType(initial?.type || 'syslog'));
  const [saving, setSaving] = useState(false);
  const supportsFormat = type === 'syslog' || type === 'webhook';

  function handleTypeChange(t) {
    setType(t);
    if (!initial) setConfig(defaultConfigForType(t));
  }
  function setCfg(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  const inputCls = "w-full px-2.5 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all";
  const inputStyle = { border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text };

  return (
    <div className="p-3 rounded-lg border shadow-sm space-y-2.5" style={{ borderColor: theme.border, backgroundColor: theme.card }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type" theme={theme}>
          <select value={type} onChange={e => handleTypeChange(e.target.value)} disabled={!!initial} className={inputCls} style={inputStyle}>
            {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Name" theme={theme}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Prod Splunk" className={inputCls} style={inputStyle} />
        </Field>
      </div>

      <p className="text-[10px] leading-relaxed" style={{ color: theme.textMuted }}>{TYPE_META[type]?.hint}</p>

      {type === 'syslog' && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2"><Field label="Host" theme={theme}>
            <input value={config.host || ''} onChange={e => setCfg('host', e.target.value)} placeholder="siem.company.com" className={inputCls} style={inputStyle} />
          </Field></div>
          <Field label="Port" theme={theme}>
            <input type="number" value={config.port ?? 514} onChange={e => setCfg('port', Number(e.target.value))} className={inputCls} style={inputStyle} />
          </Field>
        </div>
      )}

      {type === 'webhook' && (
        <>
          <Field label="URL" theme={theme}>
            <input value={config.url || ''} onChange={e => setCfg('url', e.target.value)} placeholder="https://ingest.example.com/events" className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Authorization header (optional)" theme={theme}>
            <input value={config.authHeaderValue || ''} onChange={e => setCfg('authHeaderValue', e.target.value)} placeholder="Bearer xxxxx" className={inputCls} style={inputStyle} />
          </Field>
        </>
      )}

      {supportsFormat && (
        <Field label="Format" theme={theme}>
          <select value={format} onChange={e => setFormat(e.target.value)} className={inputCls} style={inputStyle}>
            <option value="json">JSON (default — {type === 'webhook' ? 'a {"events": [...]} batch' : 'free-text "[action] message"'})</option>
            <option value="cef">CEF (Common Event Format — for SIEM ingestion: ArcSight, Splunk, QRadar, Sentinel)</option>
          </select>
        </Field>
      )}

      {type === 's3' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bucket" theme={theme}>
              <input value={config.bucket || ''} onChange={e => setCfg('bucket', e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
            <Field label="Region" theme={theme}>
              <input value={config.region || ''} onChange={e => setCfg('region', e.target.value)} placeholder="eu-west-1" className={inputCls} style={inputStyle} />
            </Field>
          </div>
          <Field label="Key prefix" theme={theme}>
            <input value={config.prefix || ''} onChange={e => setCfg('prefix', e.target.value)} placeholder="audit-logs/" className={inputCls} style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Access key ID" theme={theme}>
              <input value={config.accessKeyId || ''} onChange={e => setCfg('accessKeyId', e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
            <Field label="Secret access key" theme={theme}>
              <input type="password" value={config.secretAccessKey || ''} onChange={e => setCfg('secretAccessKey', e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
          </div>
          <Field label="Custom endpoint URL (optional — MinIO / R2 / B2 / etc.)" theme={theme}>
            <input value={config.endpointUrl || ''} onChange={e => setCfg('endpointUrl', e.target.value)} className={inputCls} style={inputStyle} />
          </Field>
        </>
      )}

      {type === 'nfs' && (
        <Field label="Directory path (mounted inside the container)" theme={theme}>
          <input value={config.path || ''} onChange={e => setCfg('path', e.target.value)} placeholder="/mnt/nfs-logs" className={inputCls} style={inputStyle} />
        </Field>
      )}

      {type === 'sftp' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><Field label="Host" theme={theme}>
              <input value={config.host || ''} onChange={e => setCfg('host', e.target.value)} className={inputCls} style={inputStyle} />
            </Field></div>
            <Field label="Port" theme={theme}>
              <input type="number" value={config.port ?? 22} onChange={e => setCfg('port', Number(e.target.value))} className={inputCls} style={inputStyle} />
            </Field>
          </div>
          <Field label="Username" theme={theme}>
            <input value={config.username || ''} onChange={e => setCfg('username', e.target.value)} className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Password (leave blank if using a private key)" theme={theme}>
            <input type="password" value={config.password || ''} onChange={e => setCfg('password', e.target.value)} className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Private key (PEM, optional)" theme={theme}>
            <textarea value={config.privateKey || ''} onChange={e => setCfg('privateKey', e.target.value)} rows={3} placeholder="-----BEGIN RSA PRIVATE KEY-----" className={`${inputCls} font-mono`} style={inputStyle} />
          </Field>
          <Field label="Remote path" theme={theme}>
            <input value={config.remotePath || ''} onChange={e => setCfg('remotePath', e.target.value)} placeholder="/logs/" className={inputCls} style={inputStyle} />
          </Field>
        </>
      )}

      <label className="flex items-center gap-2 text-xs pt-1" style={{ color: theme.text }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enabled
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ borderColor: theme.border, color: theme.textMuted }}>Cancel</button>
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={async () => { setSaving(true); try { await onSave({ type, name: name.trim(), enabled, format: supportsFormat ? format : 'json', config }); } finally { setSaving(false); } }}
          className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        >
          {initial ? 'Save changes' : 'Add destination'}
        </button>
      </div>
    </div>
  );
}

export default function LogExportDestinations({ orgSlug, theme }) {
  const [items, setItems] = useState(null);
  const [addingType, setAddingType] = useState(null); // 'new' | destinationId | null
  const [testStatus, setTestStatus] = useState({});
  const [busyId, setBusyId] = useState(null);

  const headers = { 'X-Workspace-Slug': orgSlug };

  function fetchAll() {
    axios.get('/api/settings/log-export-destinations', { headers })
      .then(res => setItems(res.data.items || []))
      .catch(() => setItems([]));
  }

  useEffect(() => { if (orgSlug) fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgSlug]);

  async function handleCreate(data) {
    await axios.post('/api/settings/log-export-destinations', data, { headers });
    setAddingType(null);
    fetchAll();
  }
  async function handleUpdate(id, data) {
    await axios.put(`/api/settings/log-export-destinations/${id}`, data, { headers });
    setAddingType(null);
    fetchAll();
  }
  async function handleDelete(dest) {
    if (!confirm(`Remove "${dest.name}"? This cannot be undone.`)) return;
    setBusyId(dest.id);
    try { await axios.delete(`/api/settings/log-export-destinations/${dest.id}`, { headers }); fetchAll(); }
    finally { setBusyId(null); }
  }
  async function handleToggle(dest) {
    setBusyId(dest.id);
    try { await axios.put(`/api/settings/log-export-destinations/${dest.id}`, { type: dest.type, name: dest.name, config: dest.config, format: dest.format || 'json', enabled: !dest.enabled }, { headers }); fetchAll(); }
    finally { setBusyId(null); }
  }
  async function handleTest(dest) {
    setTestStatus(s => ({ ...s, [dest.id]: 'pending' }));
    try {
      await axios.post(`/api/settings/log-export-destinations/${dest.id}/test`, {}, { headers });
      setTestStatus(s => ({ ...s, [dest.id]: 'ok' }));
    } catch (err) {
      setTestStatus(s => ({ ...s, [dest.id]: 'error' }));
      alert('Test delivery failed:\n\n' + (err.response?.data?.detail || err.message));
    }
    setTimeout(() => setTestStatus(s => ({ ...s, [dest.id]: undefined })), 4000);
  }

  return (
    <div className="space-y-2.5">
      {items === null ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : items.length === 0 && addingType !== 'new' ? (
        <p className="text-[11px] leading-relaxed" style={{ color: theme.textMuted }}>No destinations configured yet.</p>
      ) : (
        items.map(dest => {
          if (addingType === dest.id) {
            return <DestinationForm key={dest.id} initial={dest} theme={theme} onCancel={() => setAddingType(null)} onSave={(data) => handleUpdate(dest.id, data)} />;
          }
          const meta = TYPE_META[dest.type] || {};
          const Icon = meta.Icon || Server;
          return (
            <div key={dest.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border shadow-sm" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
              <Icon size={14} style={{ color: theme.textMuted }} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold truncate" style={{ color: theme.text }}>{dest.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{meta.label || dest.type}</span>
                  {dest.format === 'cef' && <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${SUCCESS}12`, color: SUCCESS }}>CEF</span>}
                  {!dest.enabled && <span className="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>Disabled</span>}
                </div>
                {dest.lastExportError && (
                  <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: DANGER }}><AlertTriangle size={10} /> {dest.lastExportError}</p>
                )}
              </div>
              <button type="button" disabled={busyId === dest.id} onClick={() => handleTest(dest)} title="Send test event now" className="p-1.5 rounded-lg hover:bg-blue-500/10 shrink-0" style={{ color: testStatus[dest.id] === 'ok' ? SUCCESS : testStatus[dest.id] === 'error' ? DANGER : theme.textMuted }}>
                {testStatus[dest.id] === 'ok' ? <Check size={13} /> : <TestTube size={13} />}
              </button>
              <button type="button" disabled={busyId === dest.id} onClick={() => handleToggle(dest)} title={dest.enabled ? 'Disable' : 'Enable'} className="p-1.5 rounded-lg hover:bg-blue-500/10 shrink-0" style={{ color: dest.enabled ? SUCCESS : theme.textMuted }}>
                <Power size={13} />
              </button>
              <button type="button" onClick={() => setAddingType(dest.id)} title="Edit" className="p-1.5 rounded-lg hover:bg-blue-500/10 shrink-0" style={{ color: theme.textMuted }}>
                <Pencil size={13} />
              </button>
              <button type="button" disabled={busyId === dest.id} onClick={() => handleDelete(dest)} title="Remove" className="p-1.5 rounded-lg hover:bg-red-500/10 shrink-0" style={{ color: DANGER }}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })
      )}

      {addingType === 'new' ? (
        <DestinationForm theme={theme} onCancel={() => setAddingType(null)} onSave={handleCreate} />
      ) : (
        <button type="button" onClick={() => setAddingType('new')} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-xs font-medium hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 transition-colors" style={{ borderColor: theme.border, color: theme.textMuted }}>
          <Plus size={13} /> Add destination
        </button>
      )}
    </div>
  );
}
