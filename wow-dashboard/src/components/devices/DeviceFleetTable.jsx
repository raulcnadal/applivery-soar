import React, { useState, useMemo, useEffect } from 'react';
import axios from 'axios';
import { Magnifer as Search, Smartphone, BatteryFull, AltArrowRight as ChevronRight, ShieldCheck, ShieldWarning as ShieldAlert, Play, SortVertical as ArrowUpDown, DangerTriangle as AlertTriangle, Folder as FolderIcon, RefreshCircle as ReattestIcon, Tag as TagIcon, Layers, BookmarkSquare as SavedFilterIcon, TrashBinMinimalistic as Trash2 } from '@solar-icons/react';
import { WorkflowPickerModal, WorkflowRunResultModal } from '../workflows/WorkflowRunModals';
import { SegmentPickerModal } from './DevicePickers';

// ─── Brand constants (kept in sync with App.jsx) ─────────────────────────────
const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';
const DANGER = '#EF4444';

// ─── OS badge SVG logos ───────────────────────────────────────────────────────
const OS_BADGE = {
  apple: {
    bg: '#1D1D1F',
    logo: (
      <svg viewBox="0 0 14 14" width="9" height="9" fill="white">
        <path d="M11.05 7.44c-.02-1.88 1.54-2.79 1.61-2.83-.88-1.28-2.24-1.46-2.72-1.48-1.16-.12-2.26.68-2.85.68-.59 0-1.51-.66-2.48-.64-1.27.02-2.44.74-3.09 1.87C.05 7.04.92 10.5 2.38 12.37c.72.99 1.57 2.1 2.69 2.06 1.08-.04 1.49-.7 2.79-.7 1.3 0 1.67.7 2.81.68 1.16-.02 1.89-1.01 2.6-2 .82-1.14 1.16-2.26 1.18-2.32-.03-.01-2.38-.91-2.4-2.65zM9.07 2.13C9.65 1.43 10.04.48 9.93-.5 9.05-.46 7.98.09 7.37.79c-.55.62-.99 1.59-.87 2.53.98.07 1.97-.47 2.57-1.19z" />
      </svg>
    ),
  },
  macos: {
    bg: '#1D1D1F',
    logo: (
      <svg viewBox="0 0 14 14" width="9" height="9" fill="white">
        <path d="M11.05 7.44c-.02-1.88 1.54-2.79 1.61-2.83-.88-1.28-2.24-1.46-2.72-1.48-1.16-.12-2.26.68-2.85.68-.59 0-1.51-.66-2.48-.64-1.27.02-2.44.74-3.09 1.87C.05 7.04.92 10.5 2.38 12.37c.72.99 1.57 2.1 2.69 2.06 1.08-.04 1.49-.7 2.79-.7 1.3 0 1.67.7 2.81.68 1.16-.02 1.89-1.01 2.6-2 .82-1.14 1.16-2.26 1.18-2.32-.03-.01-2.38-.91-2.4-2.65zM9.07 2.13C9.65 1.43 10.04.48 9.93-.5 9.05-.46 7.98.09 7.37.79c-.55.62-.99 1.59-.87 2.53.98.07 1.97-.47 2.57-1.19z" />
      </svg>
    ),
  },
  android: {
    bg: '#3DDC84',
    logo: (
      <svg viewBox="5 4 14 16" width="11" height="11">
        <path fill="white" d="M6 14C6 10 8.69 8 12 8s6 2 6 6V18H6v-4z" />
        <path fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" d="M8.5 8.5L7 6" />
        <path fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" d="M15.5 8.5L17 6" />
        <circle cx="9.5" cy="13" r="1.2" fill="#3DDC84" />
        <circle cx="14.5" cy="13" r="1.2" fill="#3DDC84" />
      </svg>
    ),
  },
  windows: {
    bg: '#0078D4',
    logo: (
      <svg viewBox="0 0 24 24" width="9" height="9" fill="white">
        <path d="M0 3.449L9.75 2.1v9.451H0V3.449zm10.949-1.51L24 0v11.4H10.949V1.939zM0 12.6h9.75v9.451L0 20.699V12.6zm10.949.6H24V24l-13.051-1.699V13.2z" />
      </svg>
    ),
  },
  other: {
    bg: '#6B7280',
    logo: (
      <svg viewBox="0 0 24 24" width="10" height="10" fill="white">
        <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z" />
      </svg>
    ),
  },
};

function batteryColor(pct) {
  if (pct >= 50) return SUCCESS;
  if (pct >= 20) return WARNING;
  return DANGER;
}

function DeviceMockup({ device, theme }) {
  const badge = OS_BADGE[device.platform] || OS_BADGE.other;
  return (
    <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ backgroundColor: theme.bg }}
      >
        <Smartphone size={20} style={{ color: theme.textMuted }} />
      </div>
      <div
        className="absolute rounded-full flex items-center justify-center"
        style={{ bottom: -2, left: -2, width: 20, height: 20, backgroundColor: theme.card, padding: 2 }}
      >
        <div className="w-full h-full rounded-full flex items-center justify-center" style={{ backgroundColor: badge.bg }}>
          {badge.logo}
        </div>
      </div>
    </div>
  );
}

function getUserInitials(user) {
  if (!user) return '?';
  if (user.name) {
    const parts = user.name.trim().split(' ');
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }
  return (user.firstName?.[0] || '') + (user.lastName?.[0] || '');
}

function getUserDisplayName(user) {
  if (!user) return '';
  if (user.name) return user.name;
  return `${user.firstName || ''} ${user.lastName || ''}`.trim();
}

function EmployeeCell({ user, theme }) {
  const initials = getUserInitials(user);
  const displayName = getUserDisplayName(user);
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
        style={{ backgroundColor: `${PRIMARY_BLUE}18`, color: PRIMARY_BLUE }}
      >
        {initials.toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        {displayName && (
          <p className="text-xs font-semibold truncate leading-tight" style={{ color: theme.text }}>{displayName}</p>
        )}
        {user.email && (
          <p className="text-[11px] truncate leading-tight mt-0.5" style={{ color: theme.textMuted }}>{user.email}</p>
        )}
      </div>
    </div>
  );
}

function OsUpdateBadge({ status }) {
  if (!status) return null;
  if (status.confidence === 'unknown') {
    return (
      <span title="A newer Windows security update may exist for this build, but we couldn't confirm the exact patch level from Microsoft's catalog." className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: '#6B7280' }}>
        Patch level unconfirmed
      </span>
    );
  }
  if (status.pendingCount > 0) {
    const worst = status.pendingKbs?.[0];
    return (
      <span
        title={`${status.pendingCount} security update(s) behind — latest known KB${worst ? ` ${worst.kb} (${worst.maxSeverity || 'unknown severity'})` : ''}`}
        className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold"
        style={{ color: WARNING }}
      >
        {status.pendingCount} update{status.pendingCount === 1 ? '' : 's'} behind
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: SUCCESS }}>
      Up to date
    </span>
  );
}

function VulnBadge({ status }) {
  if (!status) return null;
  if (status.confidence === 'unknown') {
    return (
      <span title="No confirmed vulnerability comparison available for this OS version yet." className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: '#6B7280' }}>
        Vuln status unconfirmed
      </span>
    );
  }
  if (status.pendingCount > 0) {
    const worst = status.pendingCves?.[0];
    return (
      <span
        title={`${status.pendingCount} known CVE(s) fixed in a newer version${worst ? ` — worst: ${worst.cveId} (${worst.baseSeverity || 'unknown'}${worst.exploited ? ', exploited in the wild' : ''})` : ''}`}
        className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold"
        style={{ color: worst?.exploited ? DANGER : WARNING }}
      >
        {status.pendingCount} CVE{status.pendingCount === 1 ? '' : 's'} pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: SUCCESS }}>
      No known pending CVEs
    </span>
  );
}

function VulnServiceBadge({ status }) {
  // status is null when the Vulnerability Service integration isn't
  // enabled for this workspace — nothing to show, not even a "pending"
  // state, since there's no scheduled refresh that will ever change that.
  // {checked: false, ...} means the integration IS enabled but nothing
  // usable is cached for this device right now — distinguish "never
  // checked yet" (lastCheckedAt null) from "was checked before, that data
  // aged out" (lastCheckedAt set) rather than rendering identical nothing
  // for both, which used to leave admins unable to tell "still waiting on
  // the first refresh" apart from "the refresh loop might be stuck."
  if (!status) return null;
  if (!status.checked) {
    if (!status.lastCheckedAt) {
      return (
        <span title="Vulnerability Service: not checked yet — waiting on the next scheduled refresh." className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: '#6B7280' }}>
          Vuln Service: pending
        </span>
      );
    }
    return (
      <span title={`Vulnerability Service: last checked ${new Date(status.lastCheckedAt).toLocaleString()} — nothing conclusive found then, and it hasn't been refreshed since. If this looks old, check Settings > Vulnerability Service for refresh errors.`} className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: '#6B7280' }}>
        Vuln Service: check stale
      </span>
    );
  }
  const counts = status.counts || {};
  const criticalHigh = (counts.CRITICAL || 0) + (counts.HIGH || 0);
  const mediumLow = (counts.MEDIUM || 0) + (counts.LOW || 0);
  if (status.hasKev) {
    const worst = status.topCves?.[0];
    return (
      <span
        title={`A known-exploited CVE (CISA KEV) is present${worst ? `: ${worst.id}` : ''} (Vulnerability Service).`}
        className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold"
        style={{ color: DANGER }}
      >
        Known-exploited CVE (Vuln Service)
      </span>
    );
  }
  if (criticalHigh > 0) {
    return (
      <span
        title={`${criticalHigh} critical/high CVE(s) found across the OS and installed apps (Vulnerability Service).`}
        className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold"
        style={{ color: DANGER }}
      >
        {criticalHigh} critical/high CVE{criticalHigh === 1 ? '' : 's'} (Vuln Service)
      </span>
    );
  }
  if (mediumLow > 0) {
    return (
      <span title="Only medium/low severity CVEs found (Vulnerability Service)." className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: WARNING }}>
        {mediumLow} medium/low CVE{mediumLow === 1 ? '' : 's'} (Vuln Service)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: SUCCESS }}>
      No known CVEs (Vuln Service)
    </span>
  );
}

function LifecycleBadge({ status }) {
  if (!status) return null;
  const rsr = status.rapidSecurityResponse?.available ? (
    <span key="rsr" title={`A Rapid Security Response is available${status.rapidSecurityResponse.cveIds?.length ? `: ${status.rapidSecurityResponse.cveIds.join(', ')}` : ''}.`} className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold" style={{ color: WARNING }}>
      Rapid Security Response available
    </span>
  ) : null;
  if (status.confidence === 'unknown' || status.isEol === null || status.isEol === undefined) return rsr;
  if (status.isEol) {
    const esu = status.esuUntil ? ` (paid ESU available until ${status.esuUntil})` : '';
    return (
      <>
        <span title={`This OS version has reached end of life for security support${esu}.`} className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold" style={{ color: DANGER }}>
          Unsupported OS
        </span>
        {rsr}
      </>
    );
  }
  if (status.onLatestVersion === false) {
    const buildSuffix = status.latestKnownBuild ? ` (${status.latestKnownBuild})` : '';
    const confidence = status.hardwareMatched === true ? 'confirmed for this hardware model'
      : status.hardwareMatched === false ? 'not confirmed for this specific hardware model — fleet-wide newest signed release shown'
      : null;
    const title = `A newer version is available: ${status.latestKnownVersion}${buildSuffix}.${confidence ? ` (${confidence})` : ''}`;
    return (
      <>
        <span title={title} className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: '#6B7280' }}>
          Not on latest ({status.latestKnownVersion})
        </span>
        {rsr}
      </>
    );
  }
  if (rsr) return rsr;
  return null;
}

function AppUpdateBadge({ status }) {
  if (!status) return null;
  if (status.pendingCount > 0) {
    const names = (status.pendingApps || []).slice(0, 3).map(a => a.name).filter(Boolean).join(', ');
    return (
      <span
        title={`${status.pendingCount} app${status.pendingCount === 1 ? '' : 's'} with an update available${names ? `: ${names}${status.pendingApps.length > 3 ? '…' : ''}` : ''}`}
        className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold"
        style={{ color: WARNING }}
      >
        {status.pendingCount} app update{status.pendingCount === 1 ? '' : 's'} pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: SUCCESS }}>
      Apps up to date
    </span>
  );
}

function ComplianceBadge({ isCompliant, title }) {
  const color = isCompliant ? SUCCESS : DANGER;
  const Icon = isCompliant ? ShieldCheck : ShieldAlert;
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${color}15`, color }}
    >
      <Icon size={12} />
      {isCompliant ? 'Compliant' : 'Non-compliant'}
    </span>
  );
}

const RISK_TIER_META = {
  low: { label: 'Low', color: SUCCESS },
  medium: { label: 'Medium', color: WARNING },
  high: { label: 'High', color: '#F97316' },
  critical: { label: 'Critical', color: DANGER },
};

function RiskBadge({ riskTier, riskScore }) {
  const meta = RISK_TIER_META[riskTier] || RISK_TIER_META.low;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${meta.color}15`, color: meta.color }}
      title={typeof riskScore === 'number' ? `Risk score: ${riskScore}/100` : undefined}
    >
      {meta.label}{typeof riskScore === 'number' ? ` · ${riskScore}` : ''}
    </span>
  );
}

function formatLastSeen(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

const PLATFORM_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'apple', label: 'iOS/iPadOS/tvOS' },
  { key: 'android', label: 'Android' },
  { key: 'windows', label: 'Windows' },
  { key: 'macos', label: 'macOS' },
];

const SAVED_FILTERS_KEY = 'huginn.devices.savedFilters';

function loadSavedFilters() {
  try {
    const raw = window.localStorage.getItem(SAVED_FILTERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedFilters(list) {
  try {
    window.localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — saved filters just won't persist this session
  }
}

export default function DeviceFleetTable({ devices, theme, onSelectDevice, apiToken, orgSlug, segmentsList }) {
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [complianceFilter, setComplianceFilter] = useState('all'); // all | compliant | non_compliant
  const [riskFilter, setRiskFilter] = useState('all'); // all | low | medium | high | critical
  const [minRiskScore, setMinRiskScore] = useState('');
  const [maxRiskScore, setMaxRiskScore] = useState('');
  const [sortBy, setSortBy] = useState(null); // null | 'risk'
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [workflows, setWorkflows] = useState([]);
  const [isPickingWorkflow, setIsPickingWorkflow] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [isReattesting, setIsReattesting] = useState(false);
  const [reattestResult, setReattestResult] = useState(null);
  const [isBulkTagging, setIsBulkTagging] = useState(false);
  const [bulkTagDraft, setBulkTagDraft] = useState('');
  const [isBulkMovingSegment, setIsBulkMovingSegment] = useState(false);
  const [isBulkActing, setIsBulkActing] = useState(false);
  const [bulkActionResult, setBulkActionResult] = useState(null);
  const [savedFilters, setSavedFilters] = useState(() => loadSavedFilters());
  const [expandedRiskId, setExpandedRiskId] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/workflows', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => setWorkflows(res.data?.items || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleRunWorkflow(workflow) {
    setIsPickingWorkflow(false);
    const targets = devices.filter(d => selectedIds.has(d.id));
    try {
      const res = await axios.post(`/api/workflows/${workflow.id}/run`, {
        devices: targets.map(d => ({
          id: d.id, displayName: d.displayName, platform: d.platform, platformDeviceId: d.platformDeviceId,
          serialNumber: d.serialNumber, osVersion: d.osVersion, manufacturer: d.manufacturer, model: d.model,
          udid: d.udid, mdmUser: d.mdmUser,
        })),
      }, { headers });
      // Response returns immediately (status: 'running') — the result modal polls for progress.
      setRunResult(res.data);
      setSelectedIds(new Set());
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to run workflow.');
    }
  }

  async function handleBulkReattest() {
    const targetIds = [...selectedIds];
    if (targetIds.length === 0) return;
    if (!window.confirm(`Push the security-attestation reporter to ${targetIds.length} selected device(s) now? Devices without a reporter script (Android/iOS) will be skipped.`)) return;
    setIsReattesting(true);
    try {
      const res = await axios.post('/api/devices/bulk-reattest', { deviceIds: targetIds }, { headers });
      setReattestResult(res.data);
      setSelectedIds(new Set());
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to push re-attestation.');
    } finally {
      setIsReattesting(false);
    }
  }

  async function handleBulkAddTag() {
    const tag = bulkTagDraft.trim();
    if (!tag) return;
    const targets = devices.filter(d => selectedIds.has(d.id));
    setIsBulkActing(true);
    setIsBulkTagging(false);
    setBulkTagDraft('');
    try {
      const results = await Promise.allSettled(targets.map(d => {
        const nextTags = (d.tags || []).includes(tag) ? (d.tags || []) : [...(d.tags || []), tag];
        return axios.put(`/api/devices/${d.platformDeviceId}/tags`, { platform: d.platform, tags: nextTags }, { headers });
      }));
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      setBulkActionResult({ label: `Tag "${tag}" added`, succeeded, total: targets.length });
      setSelectedIds(new Set());
    } finally {
      setIsBulkActing(false);
    }
  }

  async function handleBulkMoveSegment(segment) {
    setIsBulkMovingSegment(false);
    const targets = devices.filter(d => selectedIds.has(d.id));
    setIsBulkActing(true);
    try {
      const results = await Promise.allSettled(targets.map(d =>
        axios.put(`/api/devices/${d.platformDeviceId}/segment`, { platform: d.platform, segmentId: Number(segment.id) }, { headers })
      ));
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      setBulkActionResult({ label: `Moved to "${segment.name || 'segment'}"`, succeeded, total: targets.length });
      setSelectedIds(new Set());
    } finally {
      setIsBulkActing(false);
    }
  }

  function handleSaveCurrentFilter() {
    const name = window.prompt('Name this filter set:');
    if (!name || !name.trim()) return;
    const next = [...savedFilters.filter(f => f.name !== name.trim()), {
      name: name.trim(),
      filters: { search, platformFilter, complianceFilter, riskFilter, minRiskScore, maxRiskScore },
    }];
    setSavedFilters(next);
    persistSavedFilters(next);
  }

  function applySavedFilter(f) {
    const flt = f.filters || {};
    setSearch(flt.search || '');
    setPlatformFilter(flt.platformFilter || 'all');
    setComplianceFilter(flt.complianceFilter || 'all');
    setRiskFilter(flt.riskFilter || 'all');
    setMinRiskScore(flt.minRiskScore ?? '');
    setMaxRiskScore(flt.maxRiskScore ?? '');
  }

  function deleteSavedFilter(name) {
    const next = savedFilters.filter(f => f.name !== name);
    setSavedFilters(next);
    persistSavedFilters(next);
  }

  const nonCompliantCount = useMemo(() => devices.filter(d => !d.isCompliant).length, [devices]);

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      if (search) {
        const term = search.toLowerCase();
        const u = d.mdmUser;
        const userName = (u?.name || `${u?.firstName || ''} ${u?.lastName || ''}`).toLowerCase();
        const tags = (d.tags || []).join(' ').toLowerCase();
        if (
          !d.displayName.toLowerCase().includes(term) &&
          !userName.includes(term) &&
          !(u?.email || '').toLowerCase().includes(term) &&
          !tags.includes(term) &&
          !(d.serialNumber || '').toLowerCase().includes(term) &&
          !(d.imei || '').toLowerCase().includes(term) &&
          !(d.model || '').toLowerCase().includes(term)
        ) return false;
      }
      if (platformFilter !== 'all' && d.platform !== platformFilter) return false;
      if (complianceFilter === 'compliant' && !d.isCompliant) return false;
      if (complianceFilter === 'non_compliant' && d.isCompliant) return false;
      if (riskFilter !== 'all' && d.riskTier !== riskFilter) return false;
      if (minRiskScore !== '' && (d.riskScore ?? 0) < Number(minRiskScore)) return false;
      if (maxRiskScore !== '' && (d.riskScore ?? 0) > Number(maxRiskScore)) return false;
      return true;
    });
  }, [devices, search, platformFilter, complianceFilter, riskFilter, minRiskScore, maxRiskScore]);

  const sorted = useMemo(() => {
    if (sortBy !== 'risk') return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const diff = (a.riskScore ?? 0) - (b.riskScore ?? 0);
      return sortDir === 'asc' ? diff : -diff;
    });
    return copy;
  }, [filtered, sortBy, sortDir]);

  function toggleRiskSort() {
    if (sortBy !== 'risk') {
      setSortBy('risk');
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else {
      setSortBy(null);
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, boxShadow: '0px 1px 2px rgba(0,0,0,0.05)' }}
    >
      {/* ── Toolbar ── */}
      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3" style={{ borderBottom: `1px solid ${theme.border}` }}>
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
          <input
            type="text"
            placeholder="Search devices, users, serial, IMEI…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none transition-all focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
          />
        </div>

        <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
          {PLATFORM_FILTERS.map((p, i) => (
            <button
              key={p.key}
              onClick={() => setPlatformFilter(p.key)}
              className="px-3 py-2 text-xs font-medium transition-colors"
              style={{
                backgroundColor: platformFilter === p.key ? PRIMARY_BLUE : theme.card,
                color: platformFilter === p.key ? '#FFFFFF' : theme.text,
                borderRight: i < PLATFORM_FILTERS.length - 1 ? `1px solid ${theme.border}` : 'none',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setComplianceFilter(complianceFilter === 'non_compliant' ? 'all' : 'non_compliant')}
          className="px-3 py-2 text-xs font-semibold rounded-lg transition-all ml-1"
          style={{
            backgroundColor: complianceFilter === 'non_compliant' ? DANGER : `${DANGER}12`,
            color: complianceFilter === 'non_compliant' ? '#FFFFFF' : DANGER,
            border: `1px solid ${complianceFilter === 'non_compliant' ? DANGER : `${DANGER}30`}`,
          }}
        >
          Non-compliant{complianceFilter !== 'non_compliant' ? ` (${nonCompliantCount})` : ''}
        </button>

        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="px-2.5 py-2 text-xs font-medium rounded-lg outline-none"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
        >
          <option value="all">All risk tiers</option>
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk</option>
          <option value="critical">Critical risk</option>
        </select>

        <div className="flex items-center gap-1">
          <input
            type="number" min={0} max={100} placeholder="Min"
            value={minRiskScore}
            onChange={(e) => setMinRiskScore(e.target.value)}
            className="w-16 px-2 py-2 text-xs rounded-lg outline-none"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
          <span className="text-xs" style={{ color: theme.textMuted }}>–</span>
          <input
            type="number" min={0} max={100} placeholder="Max"
            value={maxRiskScore}
            onChange={(e) => setMaxRiskScore(e.target.value)}
            className="w-16 px-2 py-2 text-xs rounded-lg outline-none"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
        </div>

        {savedFilters.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const f = savedFilters.find(x => x.name === e.target.value);
              if (f) applySavedFilter(f);
            }}
            className="px-2.5 py-2 text-xs font-medium rounded-lg outline-none max-w-[140px]"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">Saved filters…</option>
            {savedFilters.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        )}
        <button
          onClick={handleSaveCurrentFilter}
          title="Save the current search/filter combination for reuse"
          className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium"
          style={{ border: `1px solid ${theme.border}`, color: theme.text }}
        >
          <SavedFilterIcon size={13} />
        </button>

        <span className="text-xs ml-auto shrink-0" style={{ color: theme.textMuted }}>
          {filtered.length} of {devices.length}
        </span>
      </div>

      {savedFilters.length > 0 && (
        <div className="px-4 py-1.5 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: `1px solid ${theme.border}` }}>
          {savedFilters.map(f => (
            <span key={f.name} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-[10px] font-semibold" style={{ backgroundColor: theme.bg, color: theme.textMuted }}>
              <button onClick={() => applySavedFilter(f)}>{f.name}</button>
              <button onClick={() => deleteSavedFilter(f.name)} style={{ color: DANGER }}><Trash2 size={9} /></button>
            </span>
          ))}
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5" style={{ backgroundColor: `${PRIMARY_BLUE}08`, borderBottom: `1px solid ${theme.border}` }}>
          <span className="text-xs font-medium" style={{ color: PRIMARY_BLUE }}>{selectedIds.size} selected</span>
          <button
            onClick={() => setIsPickingWorkflow(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          >
            <Play size={12} /> Run workflow…
          </button>
          <button
            onClick={handleBulkReattest}
            disabled={isReattesting}
            title="Push the Windows/macOS security-attestation reporter script now instead of waiting for its next scheduled run"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ border: `1px solid ${theme.border}`, color: theme.text }}
          >
            <ReattestIcon size={12} className={isReattesting ? 'animate-spin' : ''} /> {isReattesting ? 'Pushing…' : 'Re-attest now'}
          </button>
          <button
            onClick={() => setIsBulkTagging(true)}
            disabled={isBulkActing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ border: `1px solid ${theme.border}`, color: theme.text }}
          >
            <TagIcon size={12} /> Add tag…
          </button>
          <button
            onClick={() => setIsBulkMovingSegment(true)}
            disabled={isBulkActing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ border: `1px solid ${theme.border}`, color: theme.text }}
          >
            <Layers size={12} /> Move segment…
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs" style={{ color: theme.textMuted }}>Clear</button>
        </div>
      )}

      {isBulkTagging && (
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: `${PRIMARY_BLUE}08`, borderBottom: `1px solid ${theme.border}` }}>
          <input
            autoFocus
            value={bulkTagDraft}
            onChange={(e) => setBulkTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBulkAddTag(); if (e.key === 'Escape') setIsBulkTagging(false); }}
            placeholder="Tag to add to all selected devices…"
            className="flex-1 max-w-xs px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
          <button onClick={handleBulkAddTag} disabled={!bulkTagDraft.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 disabled:opacity-50">Apply</button>
          <button onClick={() => setIsBulkTagging(false)} className="text-xs" style={{ color: theme.textMuted }}>Cancel</button>
        </div>
      )}

      {reattestResult && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs" style={{ backgroundColor: `${SUCCESS}08`, borderBottom: `1px solid ${theme.border}`, color: theme.text }}>
          <span>Re-attestation pushed to {reattestResult.succeeded}/{reattestResult.total} device(s){reattestResult.succeeded < reattestResult.total ? ' — some were skipped (unsupported platform or push failure)' : ''}.</span>
          <button onClick={() => setReattestResult(null)} className="font-semibold shrink-0" style={{ color: theme.textMuted }}>Dismiss</button>
        </div>
      )}

      {bulkActionResult && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs" style={{ backgroundColor: `${SUCCESS}08`, borderBottom: `1px solid ${theme.border}`, color: theme.text }}>
          <span>{bulkActionResult.label} on {bulkActionResult.succeeded}/{bulkActionResult.total} device(s){bulkActionResult.succeeded < bulkActionResult.total ? ' — some failed' : ''}.</span>
          <button onClick={() => setBulkActionResult(null)} className="font-semibold shrink-0" style={{ color: theme.textMuted }}>Dismiss</button>
        </div>
      )}

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: theme.bg }}>
            <Smartphone size={22} style={{ color: theme.textMuted }} />
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: theme.text }}>No devices match your filters</p>
          <p className="text-sm max-w-xs" style={{ color: theme.textMuted }}>Try adjusting your search or filter criteria</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead style={{ backgroundColor: theme.bg }}>
              <tr>
                <th className="pl-4 pr-1 py-2.5 w-6">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(d => selectedIds.has(d.id))}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSelectedIds(e.target.checked ? new Set(filtered.map(d => d.id)) : new Set());
                    }}
                  />
                </th>
                {['Device', 'Employee', 'Hardware', 'OS Version', 'Compliance'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>
                  <button onClick={toggleRiskSort} className="inline-flex items-center gap-1 uppercase tracking-wider" style={{ color: sortBy === 'risk' ? PRIMARY_BLUE : theme.textMuted }}>
                    Risk <ArrowUpDown size={11} />
                  </button>
                </th>
                {['Last Seen', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, idx) => {
                const hwLabel = d.manufacturer ? `${d.manufacturer} ${d.model}`.trim() : d.model;
                return (
                  <tr
                    key={d.id}
                    className="transition-colors cursor-pointer select-none"
                    style={{ borderTop: idx > 0 ? `1px solid ${theme.border}` : 'none' }}
                    onClick={() => onSelectDevice?.(d)}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.bg; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <td className="pl-4 pr-1 py-3 w-6" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggleSelect(d.id)} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <DeviceMockup device={d} theme={theme} />
                        <div className="min-w-0">
                          <p className="font-semibold truncate" style={{ color: theme.text }}>{d.displayName}</p>
                          <span className="text-[11px]" style={{ color: theme.textMuted }}>{d.platformLabel}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {d.mdmUser ? <EmployeeCell user={d.mdmUser} theme={theme} /> : (
                        <span className="text-xs" style={{ color: theme.textMuted }}>Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate max-w-[160px]" style={{ color: theme.text }}>{hwLabel || '—'}</p>
                        {d.battery !== null && d.battery !== undefined && (
                          <div className="flex items-center gap-1 mt-1">
                            <BatteryFull size={11} style={{ color: batteryColor(d.battery) }} />
                            <span className="text-[10px] font-semibold" style={{ color: batteryColor(d.battery) }}>{d.battery}%</span>
                            <div className="w-12 h-1 rounded-full overflow-hidden" style={{ backgroundColor: theme.border }}>
                              <div className="h-full rounded-full" style={{ width: `${d.battery}%`, backgroundColor: batteryColor(d.battery) }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="text-xs" style={{ color: theme.textMuted }}>{d.osVersion || '—'}</span>
                        <OsUpdateBadge status={d.osUpdateStatus} />
                        <VulnBadge status={d.vulnStatus} />
                        <VulnServiceBadge status={d.vulnServiceStatus} />
                        <LifecycleBadge status={d.osLifecycleStatus} />
                        <AppUpdateBadge status={d.appleAppUpdateStatus} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <ComplianceBadge
                        isCompliant={d.isCompliant}
                        title={d.complianceViolations?.length
                          ? `Violates: ${d.complianceViolations.map(v => v.policyName || 'Unnamed policy').join(', ')}`
                          : undefined}
                      />
                    </td>
                    <td className="px-3 py-3 relative">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button onClick={(e) => { e.stopPropagation(); setExpandedRiskId(id => id === d.id ? null : d.id); }}>
                          <RiskBadge riskTier={d.riskTier} riskScore={d.riskScore} />
                        </button>
                        {expandedRiskId === d.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute z-20 top-full left-3 mt-1 w-64 rounded-lg shadow-xl p-3"
                            style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }}
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: theme.textMuted }}>What's driving this score</p>
                            {(d.riskFactors || []).length === 0 ? (
                              <p className="text-xs" style={{ color: theme.textMuted }}>No contributing factors — baseline score.</p>
                            ) : (
                              <div className="space-y-1">
                                {d.riskFactors.map((f, fi) => (
                                  <div key={fi} className="flex items-center justify-between gap-2 text-xs">
                                    <span style={{ color: theme.text }}>{f.label}</span>
                                    <span className="font-semibold shrink-0" style={{ color: DANGER }}>+{f.points}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {d.activeViolations?.length > 0 && (
                          <span title={`${d.activeViolations.length} active violation(s) — open the device to view`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: `${DANGER}12`, color: DANGER }}>
                            <AlertTriangle size={9} /> {d.activeViolations.length}
                          </span>
                        )}
                        {d.openCases?.length > 0 && (
                          <span title={`${d.openCases.length} open case(s) — open the device to view`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                            <FolderIcon size={9} /> {d.openCases.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs" style={{ color: theme.textMuted }}>{formatLastSeen(d.lastSeen)}</span>
                    </td>
                    <td className="px-3 py-3 w-6">
                      <ChevronRight size={14} style={{ color: theme.textMuted }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isPickingWorkflow && (
        <WorkflowPickerModal
          workflows={workflows}
          theme={theme}
          onConfirm={handleRunWorkflow}
          onClose={() => setIsPickingWorkflow(false)}
        />
      )}

      {isBulkMovingSegment && (
        <SegmentPickerModal
          segments={segmentsList}
          currentSegmentId={null}
          onSelect={handleBulkMoveSegment}
          onClose={() => setIsBulkMovingSegment(false)}
          theme={theme}
        />
      )}

      {runResult && (
        <WorkflowRunResultModal runRecord={runResult} apiToken={apiToken} orgSlug={orgSlug} theme={theme} onClose={() => setRunResult(null)} />
      )}
    </div>
  );
}
