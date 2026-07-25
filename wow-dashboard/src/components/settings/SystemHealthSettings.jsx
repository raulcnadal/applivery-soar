import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Refresh as RefreshCw, CheckCircle as CheckCircle2, CloseCircle as XCircle, DangerTriangle as AlertTriangle, ClockCircle as Clock } from '@solar-icons/react';

const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

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

function friendlyInterval(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function statusMeta(job) {
  if (job.overdue) return { label: 'Overdue', color: DANGER, Icon: AlertTriangle };
  if (job.lastStatus === 'error') return { label: 'Errored last tick', color: WARNING, Icon: XCircle };
  if (job.lastStatus === 'ok') return { label: 'Healthy', color: SUCCESS, Icon: CheckCircle2 };
  return { label: 'No data yet', color: '#6B7280', Icon: Clock };
}

export default function SystemHealthSettings({ apiToken, orgSlug, theme }) {
  const [jobs, setJobs] = useState([]);
  const [checkedAt, setCheckedAt] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const fetchHealth = useCallback(async () => {
    if (!apiToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/system-health', { headers });
      setJobs(res.data?.items || []);
      setCheckedAt(res.data?.checkedAt || null);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load system health.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken]);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const overdueCount = jobs.filter(j => j.overdue).length;

  return (
    <div>
      <p className="text-[11px] leading-relaxed mb-4" style={{ color: theme.textMuted }}>
        Every background job in this app (Compliance evaluation, ticketing sync, installed-apps refresher, workflow wait-resumer, Case SLA monitoring, scheduled reports, snapshots, audit log rotation, log export, script run reconciliation) records a heartbeat here at the end of every tick. This is global across workspaces — these jobs each iterate every workspace internally, so there's one health status per job, not one per workspace. "Overdue" means a job hasn't reported in well over its own expected interval, which is the signal an unhandled crash (as opposed to a caught, logged error) actually leaves behind.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30`, color: DANGER }}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: theme.textMuted }}>
          {overdueCount > 0 ? `${overdueCount} job${overdueCount === 1 ? '' : 's'} overdue` : 'All jobs reporting on schedule'}
          {checkedAt ? ` · checked ${timeAgo(checkedAt)}` : ''}
        </span>
        <button onClick={fetchHealth} disabled={isLoading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {isLoading && jobs.length === 0 ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => {
            const meta = statusMeta(job);
            return (
              <div key={job.key} className="p-3 rounded-xl flex items-center justify-between gap-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
                <div className="min-w-0 flex items-center gap-2.5">
                  <meta.Icon size={15} style={{ color: meta.color }} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: theme.text }}>{job.label}</p>
                    <p className="text-[11px] truncate" style={{ color: theme.textMuted }}>
                      Every {friendlyInterval(job.intervalSeconds)} · last run {timeAgo(job.lastRunAt)}
                      {job.consecutiveErrors > 0 ? ` · ${job.consecutiveErrors} error(s) in a row` : ''}
                    </p>
                    {job.lastDetail && job.lastStatus === 'error' && (
                      <p className="text-[10px] mt-0.5 truncate" style={{ color: DANGER }} title={job.lastDetail}>{job.lastDetail}</p>
                    )}
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
