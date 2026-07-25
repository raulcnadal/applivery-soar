import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { CloseCircle as X, Magnifer as Search, Structure as Workflow, CheckCircle as CheckCircle2, CloseCircle as XCircle, MinusCircle, Smartphone, ClockCircle as Clock, Play, AltArrowRight as ArrowRight, History, RefreshCircle as RotateCcw, InfoCircle as Info } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';
const DANGER = '#EF4444';

function ModalShell({ title, onClose, theme, children, wide }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl shadow-xl overflow-hidden flex flex-col`} style={{ backgroundColor: theme.card, maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <h3 className="text-sm font-semibold" style={{ color: theme.text }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 transition-opacity" style={{ color: theme.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

// ─── Device picker — used when running a workflow from the Workflows list ─────────────

const PICKER_MODES = [
  { id: 'manual', label: 'Pick devices' },
  { id: 'audience', label: 'By Device Audience' },
  { id: 'tag', label: 'By Tag' },
];

export function DevicePickerModal({ apiToken, orgSlug, theme, onConfirm, onClose }) {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [mode, setMode] = useState('manual');
  const [audiences, setAudiences] = useState([]);
  const [audienceId, setAudienceId] = useState('');
  const [tag, setTag] = useState('');

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  useEffect(() => {
    axios.get('/api/devices', { headers })
      .then(res => setDevices(res.data?.items || []))
      .finally(() => setIsLoading(false));
    // Non-critical — if this fails the "By Device Audience" mode just shows
    // an empty picker rather than blocking the whole modal.
    axios.get('/api/device-audiences', { headers })
      .then(res => setAudiences(res.data?.items || []))
      .catch(() => {});
  }, [apiToken, orgSlug]);

  const filtered = useMemo(() => devices.filter(d => d.displayName.toLowerCase().includes(search.toLowerCase())), [devices, search]);

  // Derived straight from the already-loaded fleet — every device carries
  // its live tags (see _normalize_device_full) and current Device Audience
  // memberships (see _fetch_device_audience_membership_map), so targeting
  // "everyone in Audience X" or "everyone tagged Y" needs no extra API call
  // beyond the /api/devices fetch above.
  const availableTags = useMemo(() => {
    const set = new Set();
    devices.forEach(d => (d.tags || []).forEach(t => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [devices]);

  const audienceMatches = useMemo(() => {
    if (!audienceId) return [];
    return devices.filter(d => (d.deviceAudiences || []).some(a => String(a.id) === String(audienceId)));
  }, [devices, audienceId]);

  const tagMatches = useMemo(() => {
    if (!tag) return [];
    return devices.filter(d => (d.tags || []).includes(tag));
  }, [devices, tag]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleModeChange(nextMode) {
    setMode(nextMode);
    setSelected(new Set());
    setAudienceId('');
    setTag('');
  }

  function handleConfirm() {
    if (mode === 'audience') {
      const audienceName = audiences.find(a => String(a.id) === String(audienceId))?.name || audienceId;
      onConfirm(audienceMatches, `Device Audience: ${audienceName}`);
    } else if (mode === 'tag') {
      onConfirm(tagMatches, `Tag: ${tag}`);
    } else {
      onConfirm(devices.filter(d => selected.has(d.id)), null);
    }
  }

  const bulkMatches = mode === 'audience' ? audienceMatches : mode === 'tag' ? tagMatches : null;
  const confirmCount = mode === 'manual' ? selected.size : (bulkMatches?.length || 0);
  const confirmDisabled = mode === 'manual' ? selected.size === 0 : (mode === 'audience' ? !audienceId : !tag) || confirmCount === 0;

  return (
    <ModalShell title="Select target devices" onClose={onClose} theme={theme}>
      <div className="px-4 pt-4">
        <div className="flex items-center gap-1 p-1 rounded-lg mb-3" style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}>
          {PICKER_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              className="flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                backgroundColor: mode === m.id ? theme.card : 'transparent',
                color: mode === m.id ? theme.text : theme.textMuted,
                boxShadow: mode === m.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'manual' && (
        <div className="px-4 pb-4">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices…"
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
            </div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {filtered.map(d => (
                <label key={d.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer" style={{ backgroundColor: selected.has(d.id) ? theme.bg : 'transparent' }}>
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  <Smartphone size={13} style={{ color: theme.textMuted }} />
                  <span style={{ color: theme.text }}>{d.displayName}</span>
                  <span className="ml-auto text-[10px]" style={{ color: theme.textMuted }}>{d.platformLabel}</span>
                </label>
              ))}
              {filtered.length === 0 && <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>No devices match "{search}"</p>}
            </div>
          )}
        </div>
      )}

      {mode === 'audience' && (
        <div className="px-4 pb-4">
          <select
            value={audienceId}
            onChange={(e) => setAudienceId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 mb-3"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          >
            <option value="">Choose a Device Audience…</option>
            {audiences.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {audiences.length === 0 && !isLoading && (
            <p className="text-xs mb-3" style={{ color: theme.textMuted }}>No Device Audiences found for this workspace.</p>
          )}
          {audienceId && (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {audienceMatches.map(d => (
                <div key={d.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm" style={{ color: theme.textMuted }}>
                  <Smartphone size={13} />
                  <span style={{ color: theme.text }}>{d.displayName}</span>
                  <span className="ml-auto text-[10px]">{d.platformLabel}</span>
                </div>
              ))}
              {audienceMatches.length === 0 && (
                <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>No devices currently belong to this audience.</p>
              )}
            </div>
          )}
        </div>
      )}

      {mode === 'tag' && (
        <div className="px-4 pb-4">
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 mb-3"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          >
            <option value="">Choose a tag…</option>
            {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {availableTags.length === 0 && !isLoading && (
            <p className="text-xs mb-3" style={{ color: theme.textMuted }}>No tags found on any device in the fleet.</p>
          )}
          {tag && (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {tagMatches.map(d => (
                <div key={d.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm" style={{ color: theme.textMuted }}>
                  <Smartphone size={13} />
                  <span style={{ color: theme.text }}>{d.displayName}</span>
                  <span className="ml-auto text-[10px]">{d.platformLabel}</span>
                </div>
              ))}
              {tagMatches.length === 0 && (
                <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>No devices currently carry this tag.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 justify-end px-4 pb-4">
        <span className="text-xs mr-auto" style={{ color: theme.textMuted }}>{confirmCount} selected</span>
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
        <button
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          Run on {confirmCount || ''} device{confirmCount === 1 ? '' : 's'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Workflow picker — used when running a workflow from the Devices list/drawer ──────

export function WorkflowPickerModal({ workflows, theme, onConfirm, onClose }) {
  return (
    <ModalShell title="Choose a workflow to run" onClose={onClose} theme={theme}>
      <div className="p-4 space-y-1">
        {workflows.map(p => (
          <button
            key={p.id}
            onClick={() => onConfirm(p)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors"
            style={{ color: theme.text }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.bg; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Workflow size={14} style={{ color: PRIMARY_BLUE }} />
            <div className="min-w-0">
              <p className="font-medium truncate">{p.name}</p>
              <p className="text-[11px] truncate" style={{ color: theme.textMuted }}>{p.steps?.length || 0} step{p.steps?.length === 1 ? '' : 's'}</p>
            </div>
          </button>
        ))}
        {workflows.length === 0 && (
          <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>No workflows yet — create one from the Workflows tab first.</p>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Run result — shared by every entry point ─────────────────────────────────

function statusMeta(status) {
  if (status === 'success') return { color: SUCCESS, Icon: CheckCircle2, label: 'Success' };
  if (status === 'partial') return { color: WARNING, Icon: MinusCircle, label: 'Partial' };
  return { color: DANGER, Icon: XCircle, label: 'Failed' };
}

// A device paused at a 'wait' step: no final status yet, and it may not
// resume for hours/days — the durable engine persists it and picks it back
// up on schedule, even across an API restart.
function deviceStatusMeta(result) {
  if (result.status === 'waiting') return { color: PRIMARY_BLUE, Icon: Clock, label: 'Waiting' };
  return statusMeta(result.finalStatus);
}

// Polls GET /api/workflows/runs/{id} while the run is still going — a run started
// with thousands of devices keeps executing server-side even if this modal
// (or the whole tab) is closed; reopening it (from Workflows > Recent runs) just
// resumes polling the same run id.
const POLL_INTERVAL_MS = 1500;

export function WorkflowRunResultModal({ runRecord: initialRun, apiToken, orgSlug, theme, onClose, onComplete }) {
  const [run, setRun] = useState(initialRun);
  const notifiedRef = useRef(false);

  useEffect(() => {
    // 'waiting' means the durable engine has this run parked on one or more
    // Postgres-persisted 'wait' steps — it can stay in that state for hours
    // or days, and survives an API restart, so keep polling (at the normal
    // interval; a device coming due doesn't need faster polling than this).
    if (run.status !== 'running' && run.status !== 'waiting') return undefined;
    const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };
    let cancelled = false;
    const interval = setInterval(() => {
      axios.get(`/api/workflows/runs/${run.id}`, { headers })
        .then(res => {
          if (cancelled) return;
          setRun(res.data);
          if (res.data.status !== 'running' && res.data.status !== 'waiting' && !notifiedRef.current) {
            notifiedRef.current = true;
            onComplete?.(res.data);
          }
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [run.status, run.id, apiToken, orgSlug, onComplete]);

  const isRunning = run.status === 'running';
  const isWaiting = run.status === 'waiting';
  const total = run.total ?? run.results.length;
  const completed = run.completed ?? run.results.length;
  const waitingCount = run.results.filter(r => r.status === 'waiting').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 100;

  return (
    <ModalShell title={`Run result — ${run.workflowName || 'Workflow'}`} onClose={onClose} theme={theme} wide>
      <div className="p-4">
        {run.targetDescription && (
          <p className="text-xs mb-3" style={{ color: theme.textMuted }}>Target: <span style={{ color: theme.text }}>{run.targetDescription}</span></p>
        )}
        {(isRunning || isWaiting) && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium" style={{ color: PRIMARY_BLUE }}>
                {isWaiting ? `Waiting on ${waitingCount} device${waitingCount === 1 ? '' : 's'}… ${completed} of ${total} done` : `Running… ${completed} of ${total} devices`}
              </span>
              <span className="text-xs" style={{ color: theme.textMuted }}>{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: theme.bg }}>
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: PRIMARY_BLUE }} />
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: theme.textMuted }}>
              {isWaiting
                ? 'These devices are paused at a wait step and will resume automatically on schedule — even if this server restarts. Safe to close and check back later.'
                : 'Safe to close this and come back later — the run keeps going and will show up under Recent runs.'}
            </p>
          </div>
        )}
        <div className="space-y-3">
          {run.results.map((r) => {
            const meta = deviceStatusMeta(r);
            return (
              <div key={r.deviceId} className="rounded-lg p-3" style={{ border: `1px solid ${theme.border}` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: theme.text }}>{r.deviceName || r.deviceId}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: meta.color }}>
                    <meta.Icon size={13} /> {meta.label}
                  </span>
                </div>
                <div className="space-y-1">
                  {r.steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {s.ok ? <CheckCircle2 size={12} style={{ color: SUCCESS }} /> : <XCircle size={12} style={{ color: DANGER }} />}
                      {s.phase === 'recovery' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>Recovery</span>
                      )}
                      <span style={{ color: theme.text }}>{s.name || s.type}</span>
                      <span className="ml-auto truncate max-w-[220px]" style={{ color: theme.textMuted }}>{s.detail}</span>
                    </div>
                  ))}
                  {r.steps.length === 0 && <p className="text-xs" style={{ color: theme.textMuted }}>Workflow has no steps.</p>}
                </div>
              </div>
            );
          })}
          {run.results.length === 0 && !isRunning && !isWaiting && (
            <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>No results.</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Dry run — safe, read-only preview of a workflow's step chain ─────────────
// Never executes anything server-side (see _dry_run_workflow in main.py); this
// modal just picks a device (or falls back to a labeled sample device) and
// renders the resulting step-by-step preview, including branching targets.

export function DryRunModal({ workflow, apiToken, orgSlug, theme, onClose }) {
  const [devices, setDevices] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('__sample__');
  const [preview, setPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  useEffect(() => {
    axios.get('/api/devices', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => setDevices(res.data?.items || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  const filtered = useMemo(() => devices.filter(d => d.displayName.toLowerCase().includes(search.toLowerCase())), [devices, search]);
  const selectedDevice = devices.find(d => d.id === selectedDeviceId);

  async function runPreview() {
    setIsLoading(true);
    setError(null);
    setPreview(null);
    try {
      const body = selectedDevice ? {
        device: {
          id: selectedDevice.id, displayName: selectedDevice.displayName, platform: selectedDevice.platform, platformDeviceId: selectedDevice.platformDeviceId,
          serialNumber: selectedDevice.serialNumber, osVersion: selectedDevice.osVersion, manufacturer: selectedDevice.manufacturer, model: selectedDevice.model,
          udid: selectedDevice.udid, mdmUser: selectedDevice.mdmUser,
        },
      } : {};
      const res = await axios.post(`/api/workflows/${workflow.id}/dry-run`, body, { headers });
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to preview this workflow.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ModalShell title={`Dry run — ${workflow.name}`} onClose={onClose} theme={theme} wide>
      <div className="p-4">
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg" style={{ backgroundColor: `${PRIMARY_BLUE}0C`, border: `1px solid ${PRIMARY_BLUE}25` }}>
          <Info size={14} style={{ color: PRIMARY_BLUE }} className="shrink-0 mt-0.5" />
          <p className="text-xs" style={{ color: theme.text }}>
            This is a safe preview — no MDM commands, API calls, or notifications are actually sent. Each step assumes it succeeds; the failure branch is shown for reference only.
          </p>
        </div>

        {!preview && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>Preview against</p>
            <div className="space-y-1 mb-3">
              <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer" style={{ backgroundColor: selectedDeviceId === '__sample__' ? theme.bg : 'transparent' }}>
                <input type="radio" checked={selectedDeviceId === '__sample__'} onChange={() => setSelectedDeviceId('__sample__')} />
                <span style={{ color: theme.text }}>Sample device</span>
                <span className="text-[11px]" style={{ color: theme.textMuted }}>(placeholder values, no real device needed)</span>
              </label>
            </div>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Or search a real device…"
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              />
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto mb-4">
              {filtered.map(d => (
                <label key={d.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer" style={{ backgroundColor: selectedDeviceId === d.id ? theme.bg : 'transparent' }}>
                  <input type="radio" checked={selectedDeviceId === d.id} onChange={() => setSelectedDeviceId(d.id)} />
                  <Smartphone size={13} style={{ color: theme.textMuted }} />
                  <span style={{ color: theme.text }}>{d.displayName}</span>
                  <span className="ml-auto text-[10px]" style={{ color: theme.textMuted }}>{d.platformLabel}</span>
                </label>
              ))}
            </div>
            {error && <p className="text-xs mb-3" style={{ color: DANGER }}>{error}</p>}
            <button
              onClick={runPreview}
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              <Play size={13} /> {isLoading ? 'Previewing…' : 'Run preview'}
            </button>
          </>
        )}

        {preview && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs" style={{ color: theme.textMuted }}>
                Preview for <span className="font-semibold" style={{ color: theme.text }}>{preview.device?.displayName}</span>
              </p>
              <button onClick={() => setPreview(null)} className="text-xs font-medium" style={{ color: PRIMARY_BLUE }}>Change device</button>
            </div>
            <div className="space-y-2">
              {preview.steps.map((s, i) => (
                <div key={s.stepId || i} className="rounded-lg p-3" style={{ border: `1px solid ${theme.border}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{i + 1}</span>
                    <span className="text-sm font-semibold" style={{ color: theme.text }}>{s.name || s.type}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold tracking-wide" style={{ backgroundColor: theme.bg, color: theme.textMuted }}>{s.type}</span>
                  </div>
                  <p className="text-xs mb-2" style={{ color: theme.textMuted }}>{s.summary}</p>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className="inline-flex items-center gap-1" style={{ color: SUCCESS }}>
                      <ArrowRight size={10} /> On success → {s.onSuccessLabel}
                    </span>
                    <span className="inline-flex items-center gap-1" style={{ color: DANGER }}>
                      <ArrowRight size={10} /> On failure → {s.onFailureLabel}
                    </span>
                  </div>
                </div>
              ))}
              {preview.steps.length === 0 && <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>Workflow has no steps.</p>}
            </div>

            {preview.recoverySteps && preview.recoverySteps.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>Recovery steps (run once compliance is restored)</p>
                <div className="space-y-2">
                  {preview.recoverySteps.map((s, i) => (
                    <div key={s.stepId || i} className="rounded-lg p-3" style={{ border: `1px solid ${theme.border}` }}>
                      <span className="text-sm font-semibold" style={{ color: theme.text }}>{s.name || s.type}</span>
                      <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>{s.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Version history — pre-edit snapshots, with restore ───────────────────────

function versionReasonLabel(reason) {
  if (reason === 'restore') return 'Snapshot before a restore';
  return 'Snapshot before an edit';
}

// Lightweight, index-based diff — not a true LCS diff (a step inserted in
// the middle will shift every row after it and show as "changed" rather
// than "added"), but enough to answer the question this UI actually needs:
// "roughly what's different about this old version vs what's live now?"
// without pulling in a diff library for one modal.
function summarizeStepsDiff(oldSteps, newSteps) {
  const a = oldSteps || [];
  const b = newSteps || [];
  const maxLen = Math.max(a.length, b.length);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const from = a[i];
    const to = b[i];
    if (!from && to) rows.push({ i, kind: 'added', label: to.name || to.type });
    else if (from && !to) rows.push({ i, kind: 'removed', label: from.name || from.type });
    else if (from.type !== to.type || from.name !== to.name) rows.push({ i, kind: 'changed', from: from.name || from.type, to: to.name || to.type });
  }
  return rows;
}

function VersionDiff({ theme, oldSteps, newSteps }) {
  const rows = summarizeStepsDiff(oldSteps, newSteps);
  const DIFF_COLOR = { added: SUCCESS, removed: DANGER, changed: '#F59E0B' };
  if (rows.length === 0) {
    return <p className="text-xs mt-2" style={{ color: theme.textMuted }}>No step differences vs the current version (only name/description may differ).</p>;
  }
  return (
    <div className="mt-2 space-y-1">
      {rows.map((r, idx) => (
        <p key={idx} className="text-xs" style={{ color: DIFF_COLOR[r.kind] }}>
          {r.kind === 'added' && `+ Step ${r.i + 1} added: ${r.label}`}
          {r.kind === 'removed' && `− Step ${r.i + 1} removed: ${r.label}`}
          {r.kind === 'changed' && `~ Step ${r.i + 1} changed: ${r.from} → ${r.to}`}
        </p>
      ))}
    </div>
  );
}

export function WorkflowVersionsModal({ workflow, apiToken, orgSlug, theme, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [diffOpenId, setDiffOpenId] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  useEffect(() => {
    axios.get(`/api/workflows/${workflow.id}/versions`, { headers })
      .then(res => setVersions(res.data?.items || []))
      .catch(() => setError('Failed to load version history.'))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id, apiToken, orgSlug]);

  async function handleRestore(version) {
    if (!window.confirm(`Restore "${workflow.name}" to its state from ${new Date(version.createdAt).toLocaleString()}? The current version will itself be saved to history first.`)) return;
    setRestoringId(version.id);
    try {
      await axios.post(`/api/workflows/${workflow.id}/versions/${version.id}/restore`, {}, { headers });
      onRestored?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to restore this version.');
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <ModalShell title={`Version history — ${workflow.name}`} onClose={onClose} theme={theme} wide>
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
          </div>
        ) : error ? (
          <p className="text-xs text-center py-6" style={{ color: DANGER }}>{error}</p>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <History size={22} style={{ color: theme.textMuted }} className="mb-3" />
            <p className="text-sm font-medium mb-1" style={{ color: theme.text }}>No history yet</p>
            <p className="text-xs max-w-xs" style={{ color: theme.textMuted }}>A snapshot is saved automatically every time this workflow is edited or restored.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="rounded-lg p-3" style={{ border: `1px solid ${theme.border}` }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: theme.text }}>{versionReasonLabel(v.reason)}</p>
                    <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>
                      {new Date(v.createdAt).toLocaleString()} · {v.createdBy || 'unknown'} · {v.definition?.steps?.length || 0} step{v.definition?.steps?.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setDiffOpenId(id => id === v.id ? null : v.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                    >
                      {diffOpenId === v.id ? 'Hide changes' : 'Show changes'}
                    </button>
                    <button
                      onClick={() => handleRestore(v)}
                      disabled={restoringId === v.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                    >
                      <RotateCcw size={12} /> {restoringId === v.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                </div>
                {diffOpenId === v.id && (
                  <VersionDiff theme={theme} oldSteps={v.definition?.steps} newSteps={workflow.steps} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
