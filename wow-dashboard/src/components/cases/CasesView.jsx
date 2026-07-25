import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  AddSquare as Plus, Folder as FolderOpen, CloseCircle as X, ChatRound as MessageCircle,
  ClockCircle as Clock, UsersGroupRounded as Users, DangerTriangle as AlertTriangle,
  Layers, Structure as Workflow, ShieldWarning as ShieldAlert, PlugCircle as Webhook, Pen,
  ArrowRightUp as ExternalLink, Magnifer as Search, TestTube, Tag, Pen2 as Pencil, Download, Refresh as RefreshCw,
} from '@solar-icons/react';
import { collectSegmentIds } from '../../utils/segments';
import { useMitreCatalog, MitreTagPills, MitreTagPicker } from '../shared/MitreCatalog';
import HelpIcon from '../shared/HelpIcon';

const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';
const MUTED_SLATE = '#94A3B8';

const STATUS_META = {
  open: { label: 'Open', color: WARNING },
  investigating: { label: 'Investigating', color: PRIMARY_BLUE },
  resolved: { label: 'Resolved', color: SUCCESS },
  closed: { label: 'Closed', color: MUTED_SLATE },
  false_positive: { label: 'False positive', color: MUTED_SLATE },
};
const SEVERITY_META = {
  low: { label: 'Low', color: MUTED_SLATE },
  medium: { label: 'Medium', color: WARNING },
  high: { label: 'High', color: '#F97316' },
  critical: { label: 'Critical', color: DANGER },
};
const SOURCE_META = {
  compliance_violation: { label: 'Compliance', Icon: ShieldAlert },
  workflow_trigger: { label: 'Inbound trigger', Icon: Webhook },
  manual: { label: 'Manual', Icon: Pen },
};
const VERDICT_META = {
  malicious: { label: 'Malicious', color: DANGER },
  suspicious: { label: 'Suspicious', color: WARNING },
  clean: { label: 'Clean', color: SUCCESS },
  unknown: { label: 'Unknown', color: MUTED_SLATE },
  error: { label: 'Lookup failed', color: MUTED_SLATE },
};
const STATUS_TABS = [
  { id: 'open_investigating', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
  { id: 'false_positive', label: 'False positive' },
  { id: 'all', label: 'All' },
];

function timeAgo(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Order-independent comparison — a case's tags vs. its source policy's
// current tags. Used to flag drift (see the "Sync from policy" hint) rather
// than silently auto-overwriting, since an analyst may have deliberately
// customized a case's tags away from the policy default.
function tagsMatchPolicy(caseTags, policyTags) {
  const a = new Set(caseTags || []);
  const b = new Set(policyTags || []);
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function Badge({ color, children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase" style={{ backgroundColor: `${color}15`, color }}>
      {children}
    </span>
  );
}

// SLA countdown formatting — case.slaStatus is computed fresh server-side on
// every /api/cases read (see _case_sla_status in main.py), never stored, so
// this just renders whatever ackDueAt/resolveDueAt/*Breached it was handed.
function slaCountdown(dueIso) {
  if (!dueIso) return null;
  const diffMs = new Date(dueIso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60000);
  let text;
  if (mins < 60) text = `${Math.max(mins, 1)}m`;
  else if (mins < 1440) text = `${Math.floor(mins / 60)}h`;
  else text = `${Math.floor(mins / 1440)}d`;
  return { overdue: diffMs < 0, text };
}

function SlaBadge({ slaStatus }) {
  if (!slaStatus) return null;
  if (slaStatus.resolveBreached) {
    const c = slaCountdown(slaStatus.resolveDueAt);
    return <Badge color={DANGER}>Resolve overdue{c ? ` ${c.text}` : ''}</Badge>;
  }
  if (slaStatus.ackBreached) {
    const c = slaCountdown(slaStatus.ackDueAt);
    return <Badge color={WARNING}>Ack overdue{c ? ` ${c.text}` : ''}</Badge>;
  }
  const dueIso = slaStatus.ackDueAt || slaStatus.resolveDueAt;
  if (!dueIso) return null;
  const c = slaCountdown(dueIso);
  return <Badge color={MUTED_SLATE}>Due {c.text}</Badge>;
}

export default function CasesView({ apiToken, orgSlug, theme, selectedSegment, segmentsList, currentUserEmail, openCaseId, canBulkTriage = true, canRunDestructive = true }) {
  const [cases, setCases] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open_investigating');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [assigneeSuggestions, setAssigneeSuggestions] = useState([]);
  const [tacticFilter, setTacticFilter] = useState('all');
  const [techniqueFilter, setTechniqueFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [policiesById, setPoliciesById] = useState({});
  const mitreCatalog = useMitreCatalog(apiToken, orgSlug);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchCases = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/cases', { headers });
      setCases(res.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load cases.');
    } finally {
      setIsLoading(false);
    }
  }, [apiToken, orgSlug]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  // Arriving here from another view (e.g. a Case chip in the Devices detail
  // drawer) with a specific case in mind — open it as soon as the list is
  // in, rather than requiring a second click. See openCaseId in App.jsx.
  useEffect(() => {
    if (!openCaseId || cases.length === 0) return;
    const match = cases.find(c => c.id === openCaseId);
    if (match) setSelectedCase(match);
  }, [openCaseId, cases]);

  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/cases/assignee-suggestions', { headers })
      .then(res => setAssigneeSuggestions(res.data?.items || []))
      .catch(() => {});
  }, [apiToken, orgSlug]);

  // Loaded so the Case detail can flag when its inherited MITRE tags have
  // drifted from what the source policy is tagged with today (an admin may
  // have edited the policy's tags after this case was first opened) — see
  // the "Policy tags changed" hint in CaseDetailDrawer below.
  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/compliance/policies', { headers })
      .then(res => {
        const map = {};
        (res.data?.items || []).forEach(p => { map[p.id] = p; });
        setPoliciesById(map);
      })
      .catch(() => {});
  }, [apiToken, orgSlug]);

  async function refreshSelected(caseId) {
    try {
      const res = await axios.get(`/api/cases/${caseId}`, { headers });
      setSelectedCase(res.data);
    } catch {
      // non-critical — list refresh below still reflects the change
    }
  }

  async function handleCreate(payload) {
    const res = await axios.post('/api/cases', payload, { headers });
    setIsCreating(false);
    fetchCases();
    setSelectedCase(res.data);
  }

  async function updateCase(caseId, patch) {
    await axios.put(`/api/cases/${caseId}`, patch, { headers });
    fetchCases();
    refreshSelected(caseId);
  }

  async function addNote(caseId, text) {
    if (!text.trim()) return;
    await axios.post(`/api/cases/${caseId}/notes`, { text }, { headers });
    fetchCases();
    refreshSelected(caseId);
  }

  const segmentIdSet = useMemo(() => collectSegmentIds(segmentsList, selectedSegment?.id), [segmentsList, selectedSegment]);

  const visibleCases = useMemo(() => {
    let list = cases;
    // Segment scoping: a case with no segmentId (manual cases default to
    // this) is treated as Global-scoped, same rule the Devices/Policies
    // views apply — previously null was treated as "matches every segment",
    // which meant a manual case created while scoped to one segment leaked
    // into every other segment's view too.
    if (segmentIdSet !== null) list = list.filter(c => segmentIdSet.has(String(c.segmentId ?? '0')));
    if (statusFilter === 'open_investigating') list = list.filter(c => c.status === 'open' || c.status === 'investigating');
    else if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (severityFilter !== 'all') list = list.filter(c => c.severity === severityFilter);
    if (onlyMine && currentUserEmail) list = list.filter(c => c.assignee === currentUserEmail);
    if (tacticFilter !== 'all') {
      list = list.filter(c => (c.mitreTechniques || []).some(id => mitreCatalog.techniqueById[id]?.tactic === tacticFilter));
    }
    if (techniqueFilter !== 'all') {
      list = list.filter(c => (c.mitreTechniques || []).includes(techniqueFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(c =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.deviceName || '').toLowerCase().includes(q) ||
        (c.assignee || '').toLowerCase().includes(q) ||
        (c.policyName || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [cases, segmentIdSet, statusFilter, severityFilter, onlyMine, currentUserEmail, tacticFilter, techniqueFilter, mitreCatalog.techniqueById, searchQuery]);

  const openCount = cases.filter(c => c.status === 'open' || c.status === 'investigating').length;

  // Aggregate rollup — how many cases (of any status, so this reads as
  // lifetime coverage rather than just what's currently open) touch each
  // ATT&CK tactic. Computed client-side from the already-loaded case list
  // rather than a dedicated backend endpoint, since the full set is already
  // in memory here.
  const tacticCoverage = useMemo(() => {
    const counts = {};
    cases.forEach(c => {
      const tacticsSeen = new Set((c.mitreTechniques || []).map(id => mitreCatalog.techniqueById[id]?.tactic).filter(Boolean));
      tacticsSeen.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    });
    return counts;
  }, [cases, mitreCatalog.techniqueById]);
  const hasCoverageData = Object.keys(tacticCoverage).length > 0;

  function toggleSelected(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleSelectAllVisible() {
    setSelectedIds(prev => prev.length === visibleCases.length ? [] : visibleCases.map(c => c.id));
  }

  async function handleBulkClose() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Close ${selectedIds.length} case(s)?`)) return;
    setIsBulkBusy(true);
    try {
      const res = await axios.post('/api/cases/bulk-update', { caseIds: selectedIds, status: 'closed' }, { headers });
      if (res.data?.failed?.length) console.warn('Bulk close failures:', res.data.failed);
      setSelectedIds([]);
      fetchCases();
    } catch (err) {
      alert(err.response?.data?.detail || 'Bulk close failed.');
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function handleBulkAssign() {
    if (selectedIds.length === 0 || !currentUserEmail) return;
    setIsBulkBusy(true);
    try {
      const res = await axios.post('/api/cases/bulk-update', { caseIds: selectedIds, assignee: currentUserEmail }, { headers });
      if (res.data?.failed?.length) console.warn('Bulk assign failures:', res.data.failed);
      setSelectedIds([]);
      fetchCases();
    } catch (err) {
      alert(err.response?.data?.detail || 'Bulk assign failed.');
    } finally {
      setIsBulkBusy(false);
    }
  }

  function handleExportCases() {
    axios.get('/api/cases/export', { headers, responseType: 'blob' }).then(res => {
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'cases.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    }).catch(() => alert('Failed to export cases.'));
  }

  return (
    <main className="p-8 pb-16 flex-1 relative overflow-y-auto">
      <header className="flex justify-between items-start mb-8">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold leading-tight" style={{ color: theme.text }}>Cases</h1>
            <HelpIcon slug="cases" theme={theme} title="Cases admin guide" />
            {selectedSegment && Number(selectedSegment.id) !== 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                <Layers size={10} /> {selectedSegment.name}
              </span>
            )}
            {openCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>
                {openCount} open
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: theme.textMuted }}>
            The incident layer above raw violations — track investigation status, assign an owner, and keep notes across every detection of the same problem.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportCases}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
            style={{ border: `1px solid ${theme.border}`, color: theme.text }}
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            <Plus size={15} /> New Case
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
          <AlertTriangle size={18} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
          <p className="text-sm" style={{ color: DANGER }}>{error}</p>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}>
          {STATUS_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setStatusFilter(t.id)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
              style={statusFilter === t.id ? { backgroundColor: theme.card, color: theme.text, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: theme.textMuted }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: theme.textMuted }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, device, assignee…"
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 w-56"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
          </div>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="all">All severities</option>
            {Object.entries(SEVERITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {mitreCatalog.tactics.length > 0 && (
            <select
              value={tacticFilter}
              onChange={(e) => setTacticFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              <option value="all">All ATT&CK tactics</option>
              {mitreCatalog.tactics.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          )}
          {mitreCatalog.techniques.length > 0 && (
            <select
              value={techniqueFilter}
              onChange={(e) => setTechniqueFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 max-w-[160px]"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              <option value="all">All techniques</option>
              {mitreCatalog.tactics.map(tac => (
                <optgroup key={tac.key} label={tac.name}>
                  {mitreCatalog.techniques.filter(t => t.tactic === tac.key).map(t => (
                    <option key={t.id} value={t.id}>{t.id} — {t.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {currentUserEmail && (
            <button
              onClick={() => setOnlyMine(v => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={onlyMine ? { backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE, border: `1px solid ${PRIMARY_BLUE}40` } : { border: `1px solid ${theme.border}`, color: theme.text }}
            >
              <Users size={12} /> My cases
            </button>
          )}
        </div>
      </div>

      {hasCoverageData && (
        <div className="flex items-center gap-1.5 flex-wrap mb-5 -mt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider mr-1" style={{ color: theme.textMuted }}>ATT&CK coverage:</span>
          {mitreCatalog.tactics.filter(t => tacticCoverage[t.key]).map(t => (
            <button
              key={t.key}
              onClick={() => setTacticFilter(f => f === t.key ? 'all' : t.key)}
              title={`${tacticCoverage[t.key]} case(s) touch ${t.name}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{
                backgroundColor: tacticFilter === t.key ? mitreCatalog.tacticColor[t.key] : `${mitreCatalog.tacticColor[t.key]}15`,
                color: tacticFilter === t.key ? '#FFFFFF' : mitreCatalog.tacticColor[t.key],
              }}
            >
              {t.name} · {tacticCoverage[t.key]}
            </button>
          ))}
        </div>
      )}

      {/* ── List ── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-8 h-8 border-2 rounded-full animate-spin mb-4" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
          <span className="text-xs uppercase tracking-widest font-bold" style={{ color: theme.textMuted }}>Loading cases…</span>
        </div>
      ) : visibleCases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-xl" style={{ border: `1px dashed ${theme.border}` }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: theme.bg }}>
            <FolderOpen size={22} style={{ color: theme.textMuted }} />
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: theme.text }}>
            {cases.length === 0 ? 'No Cases yet' : 'Nothing matches these filters'}
          </p>
          <p className="text-sm max-w-xs" style={{ color: theme.textMuted }}>
            {cases.length === 0
              ? 'Cases open automatically from Compliance Violations and inbound webhook triggers, or create one manually.'
              : 'Try a different status, severity, or clear "My cases".'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <label className="inline-flex items-center gap-2 text-xs" style={{ color: theme.textMuted }}>
              <input type="checkbox" checked={selectedIds.length === visibleCases.length && visibleCases.length > 0} onChange={toggleSelectAllVisible} />
              Select all ({visibleCases.length})
            </label>
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: theme.textMuted }}>{selectedIds.length} selected</span>
                {currentUserEmail && (
                  <button
                    onClick={handleBulkAssign}
                    disabled={isBulkBusy || !canBulkTriage}
                    title={!canBulkTriage ? "Your role isn't permitted to bulk-update Cases." : undefined}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                  >
                    Assign to me
                  </button>
                )}
                <button
                  onClick={handleBulkClose}
                  disabled={isBulkBusy || !canBulkTriage}
                  title={!canBulkTriage ? "Your role isn't permitted to bulk-update Cases." : undefined}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: PRIMARY_BLUE }}
                >
                  Close selected
                </button>
              </div>
            )}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
            {visibleCases.map((c, i) => {
              const statusMeta = STATUS_META[c.status] || { label: c.status, color: theme.textMuted };
              const severityMeta = SEVERITY_META[c.severity] || { label: c.severity, color: theme.textMuted };
              const sourceMeta = SOURCE_META[c.source] || { label: c.source, Icon: FolderOpen };
              return (
                <div
                  key={c.id}
                  className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  style={{ backgroundColor: theme.card, borderTop: i > 0 ? `1px solid ${theme.border}` : 'none' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(c.id)}
                    onChange={(e) => { e.stopPropagation(); toggleSelected(c.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  />
                  <button onClick={() => setSelectedCase(c)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <sourceMeta.Icon size={15} style={{ color: theme.textMuted }} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: theme.text }}>{c.title}</p>
                      <p className="text-xs truncate" style={{ color: theme.textMuted }}>
                        {sourceMeta.label}{c.assignee ? ` · Assigned to ${c.assignee}` : ' · Unassigned'} · Updated {timeAgo(c.updatedAt)}
                      </p>
                    </div>
                    {c.mitreTechniques?.length > 0 && (
                      <MitreTagPills ids={c.mitreTechniques} techniqueById={mitreCatalog.techniqueById} tacticColor={mitreCatalog.tacticColor} />
                    )}
                    <SlaBadge slaStatus={c.slaStatus} />
                    <Badge color={severityMeta.color}>{severityMeta.label}</Badge>
                    <Badge color={statusMeta.color}>{statusMeta.label}</Badge>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {isCreating && (
        <NewCaseModal theme={theme} onClose={() => setIsCreating(false)} onCreate={handleCreate} />
      )}

      {selectedCase && (
        <CaseDetailDrawer
          caseItem={selectedCase}
          theme={theme}
          apiToken={apiToken}
          orgSlug={orgSlug}
          mitreCatalog={mitreCatalog}
          sourcePolicy={selectedCase.policyId ? policiesById[selectedCase.policyId] : null}
          assigneeSuggestions={assigneeSuggestions}
          currentUserEmail={currentUserEmail}
          canRunDestructive={canRunDestructive}
          onClose={() => setSelectedCase(null)}
          onUpdate={(patch) => updateCase(selectedCase.id, patch)}
          onAddNote={(text) => addNote(selectedCase.id, text)}
          onEnriched={() => refreshSelected(selectedCase.id)}
        />
      )}
    </main>
  );
}

function NewCaseModal({ theme, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      await onCreate({ title: title.trim(), severity, notes: notes.trim() || undefined });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[270] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: theme.text }}>New Case</h2>
          <button type="button" onClick={onClose}><X size={18} style={{ color: theme.textMuted }} /></button>
        </div>
        <label className="block text-xs font-semibold mb-1" style={{ color: theme.textMuted }}>Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Suspicious login pattern on finance laptops"
          className="w-full mb-3 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
        />
        <label className="block text-xs font-semibold mb-1" style={{ color: theme.textMuted }}>Severity</label>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
        >
          {Object.entries(SEVERITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="block text-xs font-semibold mb-1" style={{ color: theme.textMuted }}>Initial note (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full mb-4 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
          <button type="submit" disabled={isSaving || !title.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
            {isSaving ? 'Creating…' : 'Create Case'}
          </button>
        </div>
      </form>
    </div>
  );
}

function RunWorkflowFromCase({ theme, apiToken, orgSlug, caseId, onDone, canRunDestructive = true }) {
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [state, setState] = useState('idle'); // idle | busy | done | error

  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/workflows', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => setWorkflows(res.data?.items || []))
      .catch(() => {});
  }, [apiToken, orgSlug]);

  const selectedWorkflow = workflows.find(w => w.id === selectedId);
  const selectedIsDestructive = (selectedWorkflow?.steps || []).some(s => s.type === 'mdm_action');
  const blockedByPermission = selectedIsDestructive && !canRunDestructive;

  async function handleRun() {
    if (!selectedId || blockedByPermission) return;
    setState('busy');
    try {
      await axios.post(`/api/cases/${caseId}/run-workflow`, { workflowId: selectedId }, { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } });
      setState('done');
      onDone?.();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to run workflow.');
      setState('error');
    } finally {
      setTimeout(() => setState('idle'), 3000);
    }
  }

  if (workflows.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: theme.textMuted }}>Run a workflow against this device</p>
      <div className="flex items-center gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
        >
          <option value="">Select workflow…</option>
          {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button
          onClick={handleRun}
          disabled={!selectedId || state === 'busy' || blockedByPermission}
          title={blockedByPermission ? "Your role isn't permitted to run workflows with a destructive MDM step." : undefined}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 shrink-0"
        >
          {state === 'busy' ? 'Running…' : state === 'done' ? 'Started' : 'Run'}
        </button>
      </div>
    </div>
  );
}

function RetryIntegrationsButton({ theme, apiToken, orgSlug, caseId, onDone }) {
  const [state, setState] = useState('idle'); // idle | busy | done | error
  async function handleRetry() {
    setState('busy');
    try {
      await axios.post(`/api/cases/${caseId}/retry-integrations`, {}, { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } });
      setState('done');
      onDone?.();
    } catch {
      setState('error');
    } finally {
      setTimeout(() => setState('idle'), 3000);
    }
  }
  return (
    <button
      onClick={handleRetry}
      disabled={state === 'busy'}
      title="Re-fire ticketing/chat dispatch for this case — useful after fixing a broken integration"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
      style={{ border: `1px solid ${theme.border}`, color: state === 'error' ? DANGER : state === 'done' ? SUCCESS : theme.text }}
    >
      <RefreshCw size={11} className={state === 'busy' ? 'animate-spin' : ''} />
      {state === 'busy' ? 'Retrying…' : state === 'done' ? 'Retried' : state === 'error' ? 'Retry failed' : 'Retry integrations'}
    </button>
  );
}

function SyncTicketStatusButton({ theme, apiToken, orgSlug, caseId, onDone }) {
  const [state, setState] = useState('idle'); // idle | busy | done | closed | error
  async function handleSync() {
    setState('busy');
    try {
      const res = await axios.post(`/api/cases/${caseId}/sync-ticket-status`, {}, { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } });
      setState(res.data?.autoClosed ? 'closed' : 'done');
      onDone?.();
    } catch {
      setState('error');
    } finally {
      setTimeout(() => setState('idle'), 3000);
    }
  }
  return (
    <button
      onClick={handleSync}
      disabled={state === 'busy'}
      title="Pull the linked ticket's live status from Jira/ServiceNow — the inbound half of ticket sync"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
      style={{ border: `1px solid ${theme.border}`, color: state === 'error' ? DANGER : (state === 'done' || state === 'closed') ? SUCCESS : theme.text }}
    >
      <RefreshCw size={11} className={state === 'busy' ? 'animate-spin' : ''} />
      {state === 'busy' ? 'Syncing…' : state === 'closed' ? 'Case auto-resolved' : state === 'done' ? 'Synced' : state === 'error' ? 'Sync failed' : 'Sync ticket status'}
    </button>
  );
}

const TIMELINE_LABEL = {
  created: 'Created', status_changed: 'Status changed', severity_changed: 'Severity changed',
  note_added: 'Note', violation_linked: 'Violation linked', workflow_run_linked: 'Workflow run',
  assigned: 'Assignment', reopened: 'Reopened', device_recovered: 'Device recovered',
};

function CaseDetailDrawer({ caseItem, theme, apiToken, orgSlug, mitreCatalog, sourcePolicy, assigneeSuggestions, currentUserEmail, canRunDestructive = true, onClose, onUpdate, onAddNote, onEnriched }) {
  const [noteText, setNoteText] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [iocValue, setIocValue] = useState('');
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState(null);
  const statusMeta = STATUS_META[caseItem.status] || { label: caseItem.status, color: theme.textMuted };
  const severityMeta = SEVERITY_META[caseItem.severity] || { label: caseItem.severity, color: theme.textMuted };
  const sourceMeta = SOURCE_META[caseItem.source] || { label: caseItem.source, Icon: FolderOpen };

  async function handleEnrich(forceRefresh) {
    if (!iocValue.trim()) return;
    setIsEnriching(true);
    setEnrichError(null);
    try {
      await axios.post(`/api/cases/${caseItem.id}/enrich`, { value: iocValue.trim(), forceRefresh: !!forceRefresh }, { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } });
      setIocValue('');
      onEnriched?.();
    } catch (err) {
      // Already-checked (409) offers a one-click "force re-check" instead of
      // just showing the error — the dedup guard on the backend is meant to
      // save a wasted lookup, not to block a deliberate re-check.
      if (err.response?.status === 409) {
        setEnrichError({ message: err.response?.data?.detail, offerForce: true });
      } else {
        setEnrichError({ message: err.response?.data?.detail || 'Enrichment failed.' });
      }
    } finally {
      setIsEnriching(false);
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setIsSubmittingNote(true);
    try {
      await onAddNote(noteText);
      setNoteText('');
    } finally {
      setIsSubmittingNote(false);
    }
  }

  const timeline = [...(caseItem.timeline || [])].reverse();

  return (
    <div className="fixed inset-0 z-[260] flex justify-end" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-[480px] h-full overflow-y-auto shadow-2xl" style={{ backgroundColor: theme.card }}>
        <div className="sticky top-0 z-10 px-6 py-4 flex items-start justify-between gap-3" style={{ backgroundColor: theme.card, borderBottom: `1px solid ${theme.border}` }}>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider mb-1 inline-flex items-center gap-1" style={{ color: theme.textMuted }}>
              <sourceMeta.Icon size={11} /> {sourceMeta.label}
            </p>
            <h2 className="text-base font-semibold leading-snug mb-1.5" style={{ color: theme.text }}>{caseItem.title}</h2>
            <SlaBadge slaStatus={caseItem.slaStatus} />
          </div>
          <button onClick={onClose} className="shrink-0"><X size={18} style={{ color: theme.textMuted }} /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status / severity / assignee editors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase mb-1" style={{ color: theme.textMuted }}>Status</label>
              <select
                value={caseItem.status}
                onChange={(e) => onUpdate({ status: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: statusMeta.color, fontWeight: 600 }}
              >
                {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase mb-1" style={{ color: theme.textMuted }}>Severity</label>
              <select
                value={caseItem.severity}
                onChange={(e) => onUpdate({ severity: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: severityMeta.color, fontWeight: 600 }}
              >
                {Object.entries(SEVERITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase mb-1" style={{ color: theme.textMuted }}>Assignee</label>
            <div className="flex items-center gap-2">
              <input
                list="case-assignee-suggestions"
                defaultValue={caseItem.assignee || ''}
                onBlur={(e) => { if (e.target.value !== (caseItem.assignee || '')) onUpdate({ assignee: e.target.value || null }); }}
                placeholder="Unassigned"
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              />
              <datalist id="case-assignee-suggestions">
                {assigneeSuggestions.map(email => <option key={email} value={email} />)}
              </datalist>
              {currentUserEmail && caseItem.assignee !== currentUserEmail && (
                <button
                  onClick={() => onUpdate({ assignee: currentUserEmail })}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold shrink-0"
                  style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                >
                  Assign to me
                </button>
              )}
            </div>
          </div>

          {/* Context: device / policy / linked violations & runs */}
          <div className="space-y-1.5 text-xs" style={{ color: theme.textMuted }}>
            {caseItem.deviceName && <p><span className="font-semibold" style={{ color: theme.text }}>Device:</span> {caseItem.deviceName}</p>}
            {caseItem.policyName && <p className="inline-flex items-center gap-1"><ShieldAlert size={11} /> <span className="font-semibold" style={{ color: theme.text }}>Policy:</span> {caseItem.policyName}</p>}
            {caseItem.violationIds?.length > 0 && <p>{caseItem.violationIds.length} linked violation{caseItem.violationIds.length === 1 ? '' : 's'}</p>}
            {caseItem.workflowRunIds?.length > 0 && <p className="inline-flex items-center gap-1"><Workflow size={11} /> {caseItem.workflowRunIds.length} workflow run{caseItem.workflowRunIds.length === 1 ? '' : 's'} launched</p>}
            <p>Opened {timeAgo(caseItem.createdAt)}{caseItem.closedAt ? ` · Closed ${timeAgo(caseItem.closedAt)}` : ''}</p>
          </div>

          {caseItem.deviceId && (
            <RunWorkflowFromCase theme={theme} apiToken={apiToken} orgSlug={orgSlug} caseId={caseItem.id} onDone={onEnriched} canRunDestructive={canRunDestructive} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {caseItem.externalRefs?.map((ref, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                  style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}
                >
                  {ref.type === 'jira' ? 'Jira' : ref.type === 'servicenow' ? 'ServiceNow' : ref.type} {ref.id} <ExternalLink size={11} />
                </a>
                {ref.remoteStatus && (
                  <span
                    title={ref.remoteStatusCheckedAt ? `Synced ${timeAgo(ref.remoteStatusCheckedAt)}` : undefined}
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: ref.remoteResolved ? `${SUCCESS}15` : `${theme.textMuted}15`, color: ref.remoteResolved ? SUCCESS : theme.textMuted }}
                  >
                    {ref.remoteStatus}
                  </span>
                )}
              </span>
            ))}
            <RetryIntegrationsButton theme={theme} apiToken={apiToken} orgSlug={orgSlug} caseId={caseItem.id} onDone={onEnriched} />
            {caseItem.externalRefs?.some(r => r.type === 'jira' || r.type === 'servicenow') && (
              <SyncTicketStatusButton theme={theme} apiToken={apiToken} orgSlug={orgSlug} caseId={caseItem.id} onDone={onEnriched} />
            )}
          </div>

          {/* MITRE ATT&CK tags */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1.5" style={{ color: theme.textMuted }}>
                <Tag size={12} /> MITRE ATT&CK
              </p>
              <button onClick={() => setIsEditingTags(v => !v)} className="text-xs font-medium inline-flex items-center gap-1" style={{ color: PRIMARY_BLUE }}>
                <Pencil size={11} /> {isEditingTags ? 'Done' : 'Edit'}
              </button>
            </div>
            {sourcePolicy && !tagsMatchPolicy(caseItem.mitreTechniques, sourcePolicy.mitreTechniques) && (
              <div className="flex items-center justify-between gap-2 mb-2 px-2.5 py-1.5 rounded-lg text-[11px]" style={{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30`, color: WARNING }}>
                <span>Source policy "{sourcePolicy.name}"'s tags have changed since this case opened.</span>
                <button
                  onClick={() => onUpdate({ mitreTechniques: sourcePolicy.mitreTechniques || [] })}
                  className="font-semibold shrink-0 underline"
                >
                  Sync from policy
                </button>
              </div>
            )}
            {isEditingTags ? (
              <MitreTagPicker
                techniques={mitreCatalog.techniques}
                tactics={mitreCatalog.tactics}
                tacticColor={mitreCatalog.tacticColor}
                selected={caseItem.mitreTechniques || []}
                onChange={(ids) => onUpdate({ mitreTechniques: ids })}
                theme={theme}
                catalogMeta={mitreCatalog.catalogMeta}
                onRefreshCatalog={mitreCatalog.refreshCatalogNow}
              />
            ) : (caseItem.mitreTechniques?.length > 0 ? (
              <MitreTagPills ids={caseItem.mitreTechniques} techniqueById={mitreCatalog.techniqueById} tacticColor={mitreCatalog.tacticColor} size="md" />
            ) : (
              <p className="text-xs" style={{ color: theme.textMuted }}>No techniques tagged.</p>
            ))}
          </div>

          {/* Threat intel enrichment */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <TestTube size={12} /> Threat Intel
            </p>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={iocValue}
                onChange={(e) => setIocValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleEnrich(false); }}
                placeholder="IP, domain, URL, file hash, or email…"
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              />
              <button
                onClick={() => handleEnrich(false)}
                disabled={isEnriching || !iocValue.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 shrink-0"
              >
                <Search size={12} /> {isEnriching ? 'Checking…' : 'Enrich'}
              </button>
            </div>
            {enrichError && (
              <p className="text-xs mb-2" style={{ color: DANGER }}>
                {enrichError.message}
                {enrichError.offerForce && (
                  <button onClick={() => handleEnrich(true)} className="ml-1 font-semibold underline">Force re-check</button>
                )}
              </p>
            )}
            <div className="space-y-1.5">
              {[...(caseItem.threatIntel || [])].reverse().map((r) => {
                const vMeta = VERDICT_META[r.verdict] || { label: r.verdict, color: theme.textMuted };
                return (
                  <div key={r.id} className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="font-mono truncate" style={{ color: theme.text }}>{r.ioc}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {r.cached && (
                          <span title={`Cached result from ${r.checkedAt ? timeAgo(r.checkedAt) : 'earlier'} — not a fresh lookup`} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>
                            Cached
                          </span>
                        )}
                        <Badge color={vMeta.color}>{vMeta.label}</Badge>
                      </div>
                    </div>
                    <p style={{ color: theme.textMuted }}>
                      {r.provider ? `${r.provider} · ` : ''}{r.detail}
                      {r.link && <> · <a href={r.link} target="_blank" rel="noreferrer" style={{ color: PRIMARY_BLUE }}>View <ExternalLink size={9} className="inline" /></a></>}
                      {r.checkedAt && ` · ${timeAgo(r.checkedAt)}`}
                    </p>
                  </div>
                );
              })}
              {(!caseItem.threatIntel || caseItem.threatIntel.length === 0) && (
                <p className="text-xs" style={{ color: theme.textMuted }}>No lookups yet.</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <MessageCircle size={12} /> Notes ({caseItem.notes?.length || 0})
            </p>
            <div className="space-y-2 mb-3">
              {(caseItem.notes || []).map(n => (
                <div key={n.id} className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}>
                  <p style={{ color: theme.text }}>{n.text}</p>
                  <p className="mt-1" style={{ color: theme.textMuted }}>{n.authorEmail} · {timeAgo(n.createdAt)}</p>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              />
              <button
                onClick={handleAddNote}
                disabled={isSubmittingNote || !noteText.trim()}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 shrink-0"
              >
                Add
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <Clock size={12} /> Timeline
            </p>
            <div className="space-y-3">
              {timeline.map(t => (
                <div key={t.id} className="flex gap-2.5 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: PRIMARY_BLUE }} />
                  <div className="min-w-0">
                    <p style={{ color: theme.text }}>{t.message}</p>
                    <p style={{ color: theme.textMuted }}>{TIMELINE_LABEL[t.type] || t.type} · {t.actor} · {timeAgo(t.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
