import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { AddSquare as Plus, ShieldWarning as ShieldAlert, Pen, TrashBinMinimalistic as Trash2, DangerTriangle as AlertTriangle, Refresh as RefreshCw, Bolt as Zap, CheckCircle as CheckCircle2, CloseCircle as XCircle, ClockCircle as Clock, Structure as Workflow, ChecklistMinimalistic as ListChecks, Layers, Folder, Download, Smartphone as DevicesIcon, ShieldCheck } from '@solar-icons/react';
import PolicyBuilder from './PolicyBuilder';
import TemplateGallery, { templateToPolicyDraft } from './TemplateGallery';
import ViewSwitcher from '../shared/ViewSwitcher';
import HelpIcon from '../shared/HelpIcon';
import { collectSegmentIds } from '../../utils/segments';

const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

function conditionSummary(policy) {
  const n = policy.conditions?.length || 0;
  if (n === 0) return 'No conditions';
  const logic = policy.conditionLogic === 'all' ? 'ALL' : 'ANY';
  return `${n} condition${n === 1 ? '' : 's'} (match ${logic})`;
}

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

export default function CompliancePoliciesView({ apiToken, orgSlug, theme, onOpenAppLists, selectedSegment, segmentsList, canDelete = true, canBulkTriage = true }) {
  const [policies, setPolicies] = useState([]);
  const [workflowsById, setWorkflowsById] = useState({});
  const [violations, setViolations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [builderPolicy, setBuilderPolicy] = useState(undefined); // undefined = closed, null = new, object = edit
  const [isTemplateGalleryOpen, setIsTemplateGalleryOpen] = useState(false);
  // null = no evaluation in flight; '' = evaluating every enabled policy;
  // a policy id = evaluating just that one. Tracked as "which" rather than
  // a plain boolean so every Evaluate control (the toolbar's scoped picker
  // AND each policy card's own quick-evaluate button) can show its own
  // busy state and all stay disabled together, preventing overlapping runs.
  const [evaluatingPolicyId, setEvaluatingPolicyId] = useState(null);
  const isEvaluating = evaluatingPolicyId !== null;
  const [evaluateScopePolicyId, setEvaluateScopePolicyId] = useState(''); // '' = All policies, in the toolbar picker
  const [evalSummary, setEvalSummary] = useState(null);
  const [busyViolationId, setBusyViolationId] = useState(null);
  const [violatorCounts, setViolatorCounts] = useState({}); // policyId -> live violator device count
  const [selectedViolationIds, setSelectedViolationIds] = useState([]);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(15);
  const [historyTotal, setHistoryTotal] = useState(0);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchAll = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const [policiesRes, workflowsRes] = await Promise.all([
        axios.get('/api/compliance/policies', { headers }),
        axios.get('/api/workflows', { headers }),
      ]);
      const loadedPolicies = policiesRes.data?.items || [];
      setPolicies(loadedPolicies);
      const map = {};
      (workflowsRes.data?.items || []).forEach(w => { map[w.id] = w; });
      setWorkflowsById(map);

      // Live "how many devices are failing this policy right now" count per
      // card — the backend already computes this for the Playground globe
      // filter, it just wasn't surfaced here. Fired in parallel, best-effort.
      const countEntries = await Promise.all(loadedPolicies.map(async (p) => {
        try {
          const res = await axios.get(`/api/compliance/policies/${p.id}/violating-device-ids`, { headers });
          return [p.id, (res.data?.deviceIds || []).length];
        } catch {
          return [p.id, null];
        }
      }));
      setViolatorCounts(Object.fromEntries(countEntries));
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load compliance policies.');
    } finally {
      setIsLoading(false);
    }
  }, [apiToken, orgSlug]);

  const fetchViolations = useCallback(async (limit) => {
    if (!apiToken || !orgSlug) return;
    try {
      const res = await axios.get('/api/compliance/violations', { headers, params: { limit: limit || historyLimit || 15 } });
      setViolations(res.data?.items || []);
      setHistoryTotal(res.data?.total ?? (res.data?.items || []).length);
    } catch {
      // non-critical
    }
  }, [apiToken, orgSlug, historyLimit]);

  useEffect(() => { fetchAll(); fetchViolations(15); }, [fetchAll]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLoadMoreHistory() {
    const next = historyLimit + 25;
    setHistoryLimit(next);
    fetchViolations(next);
  }

  function handleExportViolations() {
    const url = `/api/compliance/violations/export?${new URLSearchParams({})}`;
    axios.get(url, { headers, responseType: 'blob' }).then(res => {
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'compliance-violations.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    }).catch(() => alert('Failed to export violations.'));
  }

  async function handleDelete(policy) {
    if (!window.confirm(`Delete policy "${policy.name}"? This cannot be undone.`)) return;
    await axios.delete(`/api/compliance/policies/${policy.id}`, { headers });
    fetchAll();
  }

  // A policy that's just been created or flipped to enabled gets checked
  // against the fleet immediately server-side (in the background — see
  // create/update_compliance_policy), not on a schedule. That finishes in
  // roughly a second for one policy, so a short delayed refetch picks up
  // its lastEvaluatedAt stamp and any violation it found without the admin
  // needing to hit Refresh themselves.
  function scheduleFollowUpRefresh() {
    setTimeout(() => { fetchAll(); fetchViolations(); }, 2500);
  }

  async function toggleField(policy, field) {
    const body = { ...policy, [field]: !policy[field] };
    await axios.put(`/api/compliance/policies/${policy.id}`, body, { headers });
    fetchAll();
    if (field === 'enabled' && body.enabled) scheduleFollowUpRefresh();
  }

  function handleSaved() {
    setBuilderPolicy(undefined);
    fetchAll();
    scheduleFollowUpRefresh();
  }

  // policyId omitted/'' → every enabled policy (same as the scheduler's own
  // periodic sweep, just run on demand); a specific id → just that one, so
  // testing/tuning one policy's conditions doesn't also re-fire every other
  // autoRun policy in the workspace at the same time.
  async function handleEvaluateNow(policyId = '') {
    setEvaluatingPolicyId(policyId);
    setEvalSummary(null);
    try {
      const res = await axios.post('/api/compliance/evaluate', policyId ? { policyId } : {}, { headers });
      const scopedName = policyId ? (policies.find(p => p.id === policyId)?.name || null) : null;
      setEvalSummary({ ...res.data, scopedPolicyName: scopedName });
      fetchViolations();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to evaluate policies.');
    } finally {
      setEvaluatingPolicyId(null);
    }
  }

  async function handleApprove(violation) {
    setBusyViolationId(violation.id);
    try {
      await axios.post(`/api/compliance/violations/${violation.id}/approve`, {}, { headers });
      fetchViolations();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to approve.');
    } finally {
      setBusyViolationId(null);
    }
  }

  async function handleDismiss(violation) {
    setBusyViolationId(violation.id);
    try {
      await axios.post(`/api/compliance/violations/${violation.id}/dismiss`, {}, { headers });
      fetchViolations();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to dismiss.');
    } finally {
      setBusyViolationId(null);
    }
  }

  function toggleViolationSelected(id) {
    setSelectedViolationIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleSelectAllPending(pendingIds) {
    setSelectedViolationIds(prev => prev.length === pendingIds.length ? [] : pendingIds);
  }

  async function handleBulkApprove() {
    if (selectedViolationIds.length === 0) return;
    if (!window.confirm(`Approve & run remediation for ${selectedViolationIds.length} violation(s)?`)) return;
    setIsBulkBusy(true);
    try {
      const res = await axios.post('/api/compliance/violations/bulk-approve', { violationIds: selectedViolationIds }, { headers });
      if (res.data?.failed?.length) alert(`${res.data.failed.length} could not be approved (see console).`);
      if (res.data?.failed?.length) console.warn('Bulk approve failures:', res.data.failed);
      setSelectedViolationIds([]);
      fetchViolations();
    } catch (err) {
      alert(err.response?.data?.detail || 'Bulk approve failed.');
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function handleBulkDismiss() {
    if (selectedViolationIds.length === 0) return;
    if (!window.confirm(`Dismiss ${selectedViolationIds.length} violation(s)?`)) return;
    setIsBulkBusy(true);
    try {
      const res = await axios.post('/api/compliance/violations/bulk-dismiss', { violationIds: selectedViolationIds }, { headers });
      if (res.data?.failed?.length) console.warn('Bulk dismiss failures:', res.data.failed);
      setSelectedViolationIds([]);
      fetchViolations();
    } catch (err) {
      alert(err.response?.data?.detail || 'Bulk dismiss failed.');
    } finally {
      setIsBulkBusy(false);
    }
  }

  // Same scoping rule as the Devices view: selecting a Segment in the
  // sliding panel narrows the list to policies owned by that Segment or
  // anything beneath it (Global shows everything). Violations aren't
  // segment-filtered here since they're already tied to a specific policy +
  // device shown alongside it.
  const segmentIdSet = useMemo(() => collectSegmentIds(segmentsList, selectedSegment?.id), [segmentsList, selectedSegment]);
  const visiblePolicies = useMemo(
    () => (segmentIdSet === null ? policies : policies.filter(p => segmentIdSet.has(String(p.segmentId ?? '0')))),
    [policies, segmentIdSet]
  );

  const pending = violations.filter(v => v.status === 'pending');
  const history = violations.filter(v => v.status !== 'pending');

  return (
    <main className="p-8 pb-16 flex-1 relative overflow-y-auto">
      <header className="flex justify-between items-start mb-8 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold leading-tight" style={{ color: theme.text }}>Compliance</h1>
            <HelpIcon slug="compliance" anchor="policies-list" theme={theme} title="Compliance admin guide" />
            {selectedSegment && Number(selectedSegment.id) !== 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                <Layers size={10} /> {selectedSegment.name}
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: theme.textMuted }}>
            Policies watch device conditions and fire a linked Workflow the moment a device falls out of compliance.
          </p>
        </div>
        {/* ViewSwitcher is kept as the LAST element here, flush against the
            header's right edge — App Lists (the switcher's other tab, a
            separate routed view with no equivalent action buttons of its
            own) has nothing else in its header, so this is the only
            ordering under which the switcher lands in the same on-screen
            position in both views instead of jumping when you flip between
            them. */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Scope picker for the manual "Evaluate now" run — defaults to
              "All policies" (same as before), but picking a specific policy
              here means only that one gets checked, so testing one policy
              doesn't also re-fire every other autoRun policy at once. The
              scheduled sweep on each policy's own interval is unaffected
              either way. */}
          <select
            value={evaluateScopePolicyId}
            onChange={(e) => setEvaluateScopePolicyId(e.target.value)}
            disabled={isEvaluating}
            title="Which polic(ies) 'Evaluate now' checks"
            className="px-2.5 py-2 rounded-lg text-sm font-medium outline-none disabled:opacity-50 focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">All policies</option>
            {visiblePolicies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={() => handleEvaluateNow(evaluateScopePolicyId)}
            disabled={isEvaluating}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
            style={{ border: `1px solid ${theme.border}`, color: theme.text }}
          >
            <RefreshCw size={14} className={isEvaluating ? 'animate-spin' : ''} /> {isEvaluating ? 'Evaluating…' : 'Evaluate now'}
          </button>
          <button
            onClick={() => setIsTemplateGalleryOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
            style={{ border: `1px solid ${theme.border}`, color: theme.text }}
          >
            <ShieldCheck size={14} /> New from Template
          </button>
          <button
            onClick={() => setBuilderPolicy(null)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            <Plus size={15} /> Create Compliance Policy
          </button>
          <ViewSwitcher
            theme={theme}
            active="policies"
            onChange={(id) => { if (id === 'appLists') onOpenAppLists(); }}
            tabs={[
              { id: 'policies', label: 'Policies', Icon: ShieldAlert },
              { id: 'appLists', label: 'App Lists', Icon: ListChecks },
            ]}
          />
        </div>
      </header>

      {evalSummary && (
        <div className="mb-6 px-4 py-3 rounded-xl text-xs" style={{ backgroundColor: `${PRIMARY_BLUE}08`, border: `1px solid ${PRIMARY_BLUE}30`, color: theme.text }}>
          {evalSummary.scopedPolicyName
            ? <>Checked {evalSummary.devicesChecked} device{evalSummary.devicesChecked === 1 ? '' : 's'} against <span className="font-semibold">"{evalSummary.scopedPolicyName}"</span> — </>
            : <>Checked {evalSummary.devicesChecked} device{evalSummary.devicesChecked === 1 ? '' : 's'} against {evalSummary.evaluatedPolicies} polic{evalSummary.evaluatedPolicies === 1 ? 'y' : 'ies'} — </>}
          {' '}{evalSummary.violationsFound} new violation{evalSummary.violationsFound === 1 ? '' : 's'}
          {evalSummary.autoFired ? `, ${evalSummary.autoFired} auto-fired` : ''}
          {evalSummary.queuedForReview ? `, ${evalSummary.queuedForReview} queued for review` : ''}
          {evalSummary.recovered ? `, ${evalSummary.recovered} recovered` : ''}
          {evalSummary.autoRunSafetyBlocked ? `, ${evalSummary.autoRunSafetyBlocked} blocked by autoRun safety limits` : ''}.
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
          <AlertTriangle size={18} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
          <p className="text-sm" style={{ color: DANGER }}>{error}</p>
        </div>
      )}

      {/* ── Review queue ── */}
      {pending.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={14} style={{ color: WARNING }} />
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Awaiting review ({pending.length})</p>
            </div>
            {selectedViolationIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: theme.textMuted }}>{selectedViolationIds.length} selected</span>
                <button
                  onClick={handleBulkDismiss}
                  disabled={isBulkBusy || !canBulkTriage}
                  title={!canBulkTriage ? "Your role isn't permitted to bulk-triage violations." : undefined}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                >
                  Dismiss selected
                </button>
                <button
                  onClick={handleBulkApprove}
                  disabled={isBulkBusy || !canBulkTriage}
                  title={!canBulkTriage ? "Your role isn't permitted to bulk-triage violations." : undefined}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: PRIMARY_BLUE }}
                >
                  Approve &amp; run selected
                </button>
              </div>
            )}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
            <div
              className="flex items-center gap-3 px-4 py-2"
              style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.border}` }}
            >
              <input
                type="checkbox"
                checked={selectedViolationIds.length === pending.length}
                onChange={() => toggleSelectAllPending(pending.map(v => v.id))}
                className="shrink-0"
              />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Select all</span>
            </div>
            {pending.map((v, i) => (
              <div
                key={v.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ backgroundColor: theme.card, borderTop: i > 0 ? `1px solid ${theme.border}` : 'none' }}
              >
                <input
                  type="checkbox"
                  checked={selectedViolationIds.includes(v.id)}
                  onChange={() => toggleViolationSelected(v.id)}
                  className="shrink-0"
                />
                <ShieldAlert size={16} style={{ color: WARNING }} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: theme.text }}>{v.deviceName} <span style={{ color: theme.textMuted }}>violated</span> {v.policyName}</p>
                  <p className="text-xs truncate" style={{ color: theme.textMuted }}>
                    Would run "{v.workflowName || 'Unknown workflow'}" — {v.matchedConditions?.length || 0} matched condition{(v.matchedConditions?.length || 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  onClick={() => handleDismiss(v)}
                  disabled={busyViolationId === v.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 disabled:opacity-50"
                  style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleApprove(v)}
                  disabled={busyViolationId === v.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white shrink-0 disabled:opacity-50"
                  style={{ backgroundColor: PRIMARY_BLUE }}
                >
                  Approve &amp; run
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Policies ── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-8 h-8 border-2 rounded-full animate-spin mb-4" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
          <span className="text-xs uppercase tracking-widest font-bold" style={{ color: theme.textMuted }}>Loading policies…</span>
        </div>
      ) : visiblePolicies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-xl" style={{ border: `1px dashed ${theme.border}` }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: theme.bg }}>
            <ShieldAlert size={22} style={{ color: theme.textMuted }} />
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: theme.text }}>
            {policies.length === 0 ? 'No Compliance Policies yet' : `No policies in ${selectedSegment?.name || 'this segment'}`}
          </p>
          <p className="text-sm max-w-xs" style={{ color: theme.textMuted }}>
            {policies.length === 0
              ? 'Define what "out of compliance" means and link it to a workflow to run automatically.'
              : 'Switch to Global or another segment to see more, or create one scoped to this segment.'}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visiblePolicies.map(p => {
            const workflow = workflowsById[p.workflowId];
            return (
              <div key={p.id} className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
                <div className="flex items-start gap-2 mb-2">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${WARNING}12` }}>
                    <ShieldAlert size={16} style={{ color: WARNING }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{p.name}</p>
                    <p className="text-xs truncate" style={{ color: theme.textMuted }}>{conditionSummary(p)}</p>
                  </div>
                </div>
                {p.description && <p className="text-xs mb-2 line-clamp-2" style={{ color: theme.textMuted }}>{p.description}</p>}
                <p className="text-xs mb-1 inline-flex items-center gap-1" style={{ color: theme.textMuted }}>
                  <Workflow size={11} /> {workflow?.name || 'No workflow linked'}
                </p>
                <p className="text-xs mb-1 inline-flex items-center gap-1" style={{ color: theme.textMuted }} title={p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleString() : undefined}>
                  <Clock size={11} /> {p.lastEvaluatedAt ? `Last evaluated ${timeAgo(p.lastEvaluatedAt)}` : 'Never evaluated'}
                </p>
                <p className="text-xs mb-3 inline-flex items-center gap-1" style={{ color: violatorCounts[p.id] > 0 ? DANGER : theme.textMuted }}>
                  <DevicesIcon size={11} />
                  {violatorCounts[p.id] == null ? 'Violator count unavailable' : `${violatorCounts[p.id]} device${violatorCounts[p.id] === 1 ? '' : 's'} currently violating`}
                </p>

                <div className="flex items-center gap-1.5 mb-3">
                  <button
                    onClick={() => toggleField(p, 'enabled')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
                    style={{ backgroundColor: p.enabled ? `${SUCCESS}15` : `${theme.textMuted}15`, color: p.enabled ? SUCCESS : theme.textMuted }}
                  >
                    {p.enabled ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {p.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => toggleField(p, 'autoRun')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
                    style={{ backgroundColor: p.autoRun ? `${DANGER}12` : `${theme.textMuted}15`, color: p.autoRun ? DANGER : theme.textMuted }}
                  >
                    <Zap size={10} /> {p.autoRun ? 'Auto-run' : 'Review first'}
                  </button>
                  {p.autoRun && p.autoRunTripped && (
                    <span
                      title={p.autoRunTrippedReason || 'autoRun tripped — edit and re-save this policy to re-arm it'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
                      style={{ backgroundColor: `${DANGER}15`, color: DANGER }}
                    >
                      <XCircle size={10} /> autoRun tripped
                    </span>
                  )}
                  <button
                    onClick={() => toggleField(p, 'openCaseOnViolation')}
                    title="Whether violating this policy opens a Case — edit the policy to also control auto-resolve on recovery"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
                    style={{ backgroundColor: (p.openCaseOnViolation ?? true) ? `${PRIMARY_BLUE}12` : `${theme.textMuted}15`, color: (p.openCaseOnViolation ?? true) ? PRIMARY_BLUE : theme.textMuted }}
                  >
                    <Folder size={10} /> {(p.openCaseOnViolation ?? true) ? (p.autoResolveCaseOnRecovery ? 'Cases: auto-resolve' : 'Cases: on') : 'Cases: off'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEvaluateNow(p.id)}
                    disabled={isEvaluating}
                    title="Evaluate just this policy now, without touching any other policy's autoRun"
                    className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                  >
                    <RefreshCw size={13} className={evaluatingPolicyId === p.id ? 'animate-spin' : ''} />
                  </button>
                  <button onClick={() => setBuilderPolicy(p)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
                    <Pen size={12} /> Edit
                  </button>
                  <button onClick={() => handleDelete(p)} disabled={!canDelete} title={!canDelete ? "Your role isn't permitted to delete Compliance Policies." : undefined} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: `1px solid ${theme.border}`, color: DANGER }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Violation history ── */}
      {history.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>
              Recent activity {historyTotal ? `(${history.length} of ${historyTotal})` : ''}
            </p>
            <button
              onClick={handleExportViolations}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
              style={{ border: `1px solid ${theme.border}`, color: theme.text }}
            >
              <Download size={12} /> Export CSV
            </button>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
            {history.map((v, i) => {
              const statusMeta = {
                auto_fired: { color: PRIMARY_BLUE, label: 'Auto-fired' },
                approved: { color: SUCCESS, label: 'Approved & ran' },
                dismissed: { color: theme.textMuted, label: 'Dismissed' },
                no_workflow: { color: WARNING, label: 'No workflow linked' },
                autorun_blocked: { color: DANGER, label: 'autoRun blocked' },
                autorun_capped: { color: WARNING, label: 'autoRun capped — queued' },
                workflow_unavailable: { color: DANGER, label: 'Workflow unavailable' },
              }[v.status] || { color: theme.textMuted, label: v.status };
              return (
                <div key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-sm" style={{ backgroundColor: theme.card, borderTop: i > 0 ? `1px solid ${theme.border}` : 'none' }}>
                  <span className="truncate flex-1" style={{ color: theme.text }}>
                    {v.deviceName} — {v.policyName}
                    {v.escalated && (
                      <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${DANGER}15`, color: DANGER }} title={`Escalated to "${v.workflowName}" based on device risk tier`}>
                        Escalated
                      </span>
                    )}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: statusMeta.color }}>{statusMeta.label}</span>
                </div>
              );
            })}
          </div>
          {history.length < historyTotal && (
            <button
              onClick={handleLoadMoreHistory}
              className="mt-3 w-full py-2 rounded-lg text-xs font-semibold"
              style={{ border: `1px solid ${theme.border}`, color: theme.text }}
            >
              Load more ({historyTotal - history.length} remaining)
            </button>
          )}
        </div>
      )}

      {builderPolicy !== undefined && (
        <PolicyBuilder
          policy={builderPolicy}
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setBuilderPolicy(undefined)}
          onSaved={handleSaved}
          defaultSegment={selectedSegment}
        />
      )}

      {isTemplateGalleryOpen && (
        <TemplateGallery
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setIsTemplateGalleryOpen(false)}
          onUseTemplate={(template, frameworkLabel) => {
            setIsTemplateGalleryOpen(false);
            setBuilderPolicy(templateToPolicyDraft(template, frameworkLabel));
          }}
        />
      )}

    </main>
  );
}
