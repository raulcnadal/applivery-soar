import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { AddSquare as Plus, Structure as Workflow, Pen, TrashBinMinimalistic as Trash2, Play, DangerTriangle as AlertTriangle, History, CheckCircle as CheckCircle2, CloseCircle as XCircle, MinusCircle, Refresh as Loader2, ClockCircle as Clock, Library, TestTube, Download, ShieldCheck } from '@solar-icons/react';
import WorkflowBuilder from './WorkflowBuilder';
import { DevicePickerModal, WorkflowRunResultModal, DryRunModal, WorkflowVersionsModal } from './WorkflowRunModals';
import ActionLibraryView from './ActionLibraryView';
import FirewallLibraryView from './FirewallLibraryView';
import ViewSwitcher from '../shared/ViewSwitcher';
import HelpIcon from '../shared/HelpIcon';

// Heading ids inside docs/workflows.md for each sub-view tab.
const WORKFLOWS_TAB_ANCHORS = { workflows: 'workflow-list', library: 'script--oma-uri-library', firewall: 'firewall-policy-library' };

const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const PLATFORM_LABELS = { apple: 'iOS', macos: 'macOS', android: 'Android', windows: 'Windows', aosp: 'AOSP' };
const MODEL_LABELS = {
  supervised: 'Supervised', unsupervised: 'Unsupervised',
  work_profile: 'Work Profile', cope: 'COPE', device_owner: 'Device Owner',
};

function runStatusMeta(run) {
  if (run.status === 'running') return { color: PRIMARY_BLUE, Icon: Loader2, label: `Running ${run.completed ?? 0}/${run.total ?? '?'}`, spin: true };
  // Durable engine: one or more devices are parked at a 'wait' step,
  // possibly for hours/days — the run stays open (not yet in history)
  // until the resumer loop finishes every device.
  if (run.status === 'waiting') return { color: PRIMARY_BLUE, Icon: Clock, label: `Waiting ${run.completed ?? 0}/${run.total ?? '?'}`, spin: false };
  const statuses = (run.results || []).map(r => r.finalStatus);
  if (statuses.length && statuses.every(s => s === 'success')) return { color: SUCCESS, Icon: CheckCircle2, label: 'Completed' };
  if (statuses.some(s => s === 'success' || s === 'partial')) return { color: WARNING, Icon: MinusCircle, label: 'Partial' };
  return { color: DANGER, Icon: XCircle, label: 'Failed' };
}

export default function WorkflowsView({ apiToken, orgSlug, theme, canDelete = true, canRunDestructive = true }) {
  const [workflows, setWorkflows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [builderWorkflow, setBuilderWorkflow] = useState(undefined); // undefined = closed, null = new, object = edit
  const [runningWorkflow, setRunningWorkflow] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [dryRunWorkflow, setDryRunWorkflow] = useState(null);
  const [historyWorkflow, setHistoryWorkflow] = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [runsLimit, setRunsLimit] = useState(10);
  const [runDateFrom, setRunDateFrom] = useState('');
  const [runDateTo, setRunDateTo] = useState('');
  const [tab, setTab] = useState('workflows'); // 'workflows' | 'library' | 'firewall'

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchWorkflows = useCallback(async () => {
    if (!apiToken || !orgSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/workflows', { headers });
      setWorkflows(res.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load workflows.');
    } finally {
      setIsLoading(false);
    }
  }, [apiToken, orgSlug]);

  const fetchRecentRuns = useCallback(async (limit) => {
    if (!apiToken || !orgSlug) return;
    try {
      const params = { limit: limit || runsLimit };
      if (runDateFrom) params.date_from = runDateFrom;
      if (runDateTo) params.date_to = runDateTo;
      const res = await axios.get('/api/workflows/runs', { headers, params });
      setRecentRuns(res.data?.items || []);
    } catch {
      // non-critical — history is a nice-to-have
    }
  }, [apiToken, orgSlug, runsLimit, runDateFrom, runDateTo]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);
  useEffect(() => { fetchRecentRuns(); }, [fetchRecentRuns]);

  function handleExportRuns() {
    const params = new URLSearchParams();
    if (runDateFrom) params.set('date_from', runDateFrom);
    if (runDateTo) params.set('date_to', runDateTo);
    axios.get(`/api/workflows/runs/export?${params}`, { headers, responseType: 'blob' }).then(res => {
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'workflow-runs.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    }).catch(() => alert('Failed to export workflow runs.'));
  }

  async function handleDelete(workflow) {
    if (!window.confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) return;
    await axios.delete(`/api/workflows/${workflow.id}`, { headers });
    fetchWorkflows();
  }

  function handleSaved() {
    setBuilderWorkflow(undefined);
    fetchWorkflows();
  }

  async function handleRunConfirm(devices, targetDescription) {
    try {
      const res = await axios.post(`/api/workflows/${runningWorkflow.id}/run`, {
        devices: devices.map(d => ({
          id: d.id, displayName: d.displayName, platform: d.platform, platformDeviceId: d.platformDeviceId,
          serialNumber: d.serialNumber, osVersion: d.osVersion, manufacturer: d.manufacturer, model: d.model,
          udid: d.udid, mdmUser: d.mdmUser,
        })),
        targetDescription: targetDescription || null,
      }, { headers });
      // Response returns immediately (status: 'running') — the result modal polls for progress.
      setRunningWorkflow(null);
      setRunResult(res.data);
      fetchRecentRuns();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to run workflow.');
    }
  }

  return (
    <main className="p-8 pb-16 flex-1 relative overflow-y-auto">
      <header className="flex justify-between items-start mb-8 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold leading-tight" style={{ color: theme.text }}>Workflows</h1>
            <HelpIcon slug="workflows" anchor={WORKFLOWS_TAB_ANCHORS[tab]} theme={theme} title="Workflows admin guide" />
          </div>
          <p className="text-sm mt-1" style={{ color: theme.textMuted }}>
            Chained actions — MDM commands, API calls, and notifications. Run manually, auto-fired by Compliance Policies on violation, or launched directly from a Case.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <ViewSwitcher
            theme={theme}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'workflows', label: 'Workflows', Icon: Workflow },
              { id: 'library',   label: 'Script & OMA-URI Library', Icon: Library },
              { id: 'firewall',  label: 'Firewall Policy Library', Icon: ShieldCheck },
            ]}
          />
          {/* Always rendered (rather than conditionally mounted) so its layout
              space stays reserved even on the Library tab — otherwise the
              ViewSwitcher next to it visibly shifts position depending on
              which tab is active, since removing this button changes the
              row's total width. */}
          <button
            onClick={() => setBuilderWorkflow(null)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${tab === 'workflows' ? '' : 'invisible pointer-events-none'}`}
            aria-hidden={tab !== 'workflows'}
            tabIndex={tab === 'workflows' ? 0 : -1}
          >
            <Plus size={15} /> Create Workflow
          </button>
        </div>
      </header>

      {tab === 'library' ? (
        <ActionLibraryView apiToken={apiToken} orgSlug={orgSlug} theme={theme} />
      ) : tab === 'firewall' ? (
        <FirewallLibraryView apiToken={apiToken} orgSlug={orgSlug} theme={theme} />
      ) : isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-8 h-8 border-2 rounded-full animate-spin mb-4" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
          <span className="text-xs uppercase tracking-widest font-bold" style={{ color: theme.textMuted }}>Loading workflows…</span>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
          <AlertTriangle size={18} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
          <p className="text-sm" style={{ color: DANGER }}>{error}</p>
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-xl" style={{ border: `1px dashed ${theme.border}` }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: theme.bg }}>
            <Workflow size={22} style={{ color: theme.textMuted }} />
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: theme.text }}>No workflows yet</p>
          <p className="text-sm max-w-xs" style={{ color: theme.textMuted }}>Create a chain of actions you can run against one or many devices.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map(p => {
            const hasDestructive = (p.steps || []).some(s => s.type === 'mdm_action');
            return (
              <div key={p.id} className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
                <div className="flex items-start gap-2 mb-2">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${PRIMARY_BLUE}12` }}>
                    <Workflow size={16} style={{ color: PRIMARY_BLUE }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{p.name}</p>
                    <p className="text-xs truncate flex items-center gap-1" style={{ color: theme.textMuted }}>
                      {p.steps?.length || 0} step{p.steps?.length === 1 ? '' : 's'}
                      {hasDestructive && (
                        <span className="inline-flex items-center gap-0.5" style={{ color: WARNING }} title="Includes MDM device actions">
                          <AlertTriangle size={10} /> MDM
                        </span>
                      )}
                      {hasDestructive && p.allowUnattendedDestructive && (
                        <span className="inline-flex items-center gap-0.5" style={{ color: SUCCESS }} title="Marked by its author as approved to run unattended — each Policy/Rule that fires it still needs its own separate acknowledgment">
                          <ShieldCheck size={10} /> Auto-run approved
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {p.targetPlatform && (
                  <span className="inline-flex items-center gap-1 mb-2 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                    {PLATFORM_LABELS[p.targetPlatform] || p.targetPlatform}
                    {p.targetDeploymentModel && ` · ${MODEL_LABELS[p.targetDeploymentModel] || p.targetDeploymentModel}`}
                  </span>
                )}
                {p.description && <p className="text-xs mb-3 line-clamp-2" style={{ color: theme.textMuted }}>{p.description}</p>}
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setRunningWorkflow(p)}
                    disabled={hasDestructive && !canRunDestructive}
                    title={hasDestructive && !canRunDestructive ? "Your role isn't permitted to run workflows with a destructive MDM step." : undefined}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: PRIMARY_BLUE }}
                  >
                    <Play size={12} /> Run
                  </button>
                  <button onClick={() => setDryRunWorkflow(p)} title="Dry run — safe preview, nothing is executed" className="p-1.5 rounded-lg" style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}>
                    <TestTube size={13} />
                  </button>
                  <button onClick={() => setHistoryWorkflow(p)} title="Version history" className="p-1.5 rounded-lg" style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}>
                    <History size={13} />
                  </button>
                  <button onClick={() => setBuilderWorkflow(p)} className="p-1.5 rounded-lg" style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}>
                    <Pen size={13} />
                  </button>
                  <button onClick={() => handleDelete(p)} disabled={!canDelete} title={!canDelete ? "Your role isn't permitted to delete Workflows." : undefined} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: `1px solid ${theme.border}`, color: DANGER }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'workflows' && (
        <div className="mt-8">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex items-center gap-2">
              <History size={14} style={{ color: theme.textMuted }} />
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Recent runs</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={runDateFrom}
                onChange={(e) => setRunDateFrom(e.target.value)}
                className="px-2 py-1 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              />
              <span className="text-xs" style={{ color: theme.textMuted }}>to</span>
              <input
                type="date"
                value={runDateTo}
                onChange={(e) => setRunDateTo(e.target.value)}
                className="px-2 py-1 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              />
              <button
                onClick={handleExportRuns}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                style={{ border: `1px solid ${theme.border}`, color: theme.text }}
              >
                <Download size={12} /> Export CSV
              </button>
            </div>
          </div>
          {recentRuns.length === 0 ? (
            <p className="text-xs py-4" style={{ color: theme.textMuted }}>No runs in this range yet.</p>
          ) : (
            <>
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
                {recentRuns.map((run, i) => {
                  const meta = runStatusMeta(run);
                  return (
                    <button
                      key={run.id}
                      onClick={() => setRunResult(run)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                      style={{ backgroundColor: theme.card, borderTop: i > 0 ? `1px solid ${theme.border}` : 'none' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.bg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = theme.card; }}
                    >
                      <meta.Icon size={14} style={{ color: meta.color }} className={meta.spin ? 'animate-spin' : ''} />
                      <div className="min-w-0">
                        <span className="text-sm font-medium truncate block" style={{ color: theme.text }}>{run.workflowName || 'Workflow'}</span>
                        {run.targetDescription && (
                          <span className="text-[11px] truncate block" style={{ color: theme.textMuted }}>{run.targetDescription}</span>
                        )}
                      </div>
                      <span className="text-xs shrink-0 ml-auto" style={{ color: theme.textMuted }}>
                        {run.total ?? run.results?.length ?? 0} device{(run.total ?? run.results?.length) === 1 ? '' : 's'}
                      </span>
                      <span className="text-xs shrink-0" style={{ color: meta.color }}>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => { const next = runsLimit + 20; setRunsLimit(next); fetchRecentRuns(next); }}
                className="mt-3 w-full py-2 rounded-lg text-xs font-semibold"
                style={{ border: `1px solid ${theme.border}`, color: theme.text }}
              >
                Show more
              </button>
            </>
          )}
        </div>
      )}

      {builderWorkflow !== undefined && (
        <WorkflowBuilder
          workflow={builderWorkflow}
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setBuilderWorkflow(undefined)}
          onSaved={handleSaved}
        />
      )}

      {runningWorkflow && (
        <DevicePickerModal
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onConfirm={handleRunConfirm}
          onClose={() => setRunningWorkflow(null)}
        />
      )}

      {runResult && (
        <WorkflowRunResultModal
          runRecord={runResult}
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setRunResult(null)}
          onComplete={fetchRecentRuns}
        />
      )}

      {dryRunWorkflow && (
        <DryRunModal
          workflow={dryRunWorkflow}
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setDryRunWorkflow(null)}
        />
      )}

      {historyWorkflow && (
        <WorkflowVersionsModal
          workflow={historyWorkflow}
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setHistoryWorkflow(null)}
          onRestored={fetchWorkflows}
        />
      )}
    </main>
  );
}
