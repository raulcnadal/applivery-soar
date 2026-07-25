import React, { useState, useMemo, useEffect } from 'react';
import axios from 'axios';
import { CloseCircle as X, MapPoint as MapPin, ArrowRightUp as ExternalLink, Refresh as RefreshCw, ShieldCheck, ShieldWarning as ShieldAlert, Layers, Pen, AddSquare as Plus, TrashBinMinimalistic as Trash2, Smartphone, Play } from '@solar-icons/react';
import { SegmentPickerModal, PolicyPickerModal, TagEditorModal, flattenSegments } from './DevicePickers';
import { WorkflowPickerModal, WorkflowRunResultModal } from '../workflows/WorkflowRunModals';

const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';
const DANGER = '#EF4444';

const RISK_TIER_META = {
  low: { label: 'Low', color: SUCCESS },
  medium: { label: 'Medium', color: WARNING },
  high: { label: 'High', color: '#F97316' },
  critical: { label: 'Critical', color: DANGER },
};

const PLATFORM_PATH = { apple: 'apple', macos: 'apple', android: 'android', windows: 'windows' };

function Section({ title, action, theme, children }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, theme, mono }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-center justify-between py-1.5 text-sm" style={{ borderBottom: `1px solid ${theme.border}` }}>
      <span style={{ color: theme.textMuted }}>{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''} style={{ color: theme.text }}>{value}</span>
    </div>
  );
}

function ComplianceBadge({ isCompliant, title }) {
  const color = isCompliant ? SUCCESS : DANGER;
  const Icon = isCompliant ? ShieldCheck : ShieldAlert;
  return (
    <span title={title} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${color}15`, color }}>
      <Icon size={12} />
      {isCompliant ? 'Compliant' : 'Non-compliant'}
    </span>
  );
}

function RiskBadge({ riskTier, riskScore }) {
  const meta = RISK_TIER_META[riskTier] || RISK_TIER_META.low;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
      {meta.label} risk{typeof riskScore === 'number' ? ` · ${riskScore}` : ''}
    </span>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'location', label: 'Location' },
];

export default function DeviceDetailDrawer({ device, apiToken, orgSlug, segmentsList, theme, onClose, onDeviceUpdated, onRequestRefresh, onOpenCase, onOpenDeviceAudit }) {
  const [tab, setTab] = useState('overview');
  const [activePicker, setActivePicker] = useState(null); // 'segment' | 'policy' | 'tags' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [isSyncingLocation, setIsSyncingLocation] = useState(false);
  const [workflows, setWorkflows] = useState([]);
  const [isPickingWorkflow, setIsPickingWorkflow] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [firewallState, setFirewallState] = useState(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }), [apiToken, orgSlug]);
  const platform = PLATFORM_PATH[device?.platform];

  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/workflows', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => setWorkflows(res.data?.items || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug]);

  // Firewall Rule Sets are Windows-only and not (yet) folded into the bulk
  // device-list payload the way vulnServiceStatus etc. are — a dedicated,
  // per-device fetch, same as the workflows list above.
  useEffect(() => {
    if (!apiToken || !orgSlug || !device?.id || device?.platform !== 'windows') { setFirewallState(null); return; }
    axios.get(`/api/devices/${device.id}/firewall-state`, { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => setFirewallState(res.data || { active: [] }))
      .catch(() => setFirewallState({ active: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, orgSlug, device?.id, device?.platform]);

  async function handleRunWorkflow(workflow) {
    setIsPickingWorkflow(false);
    try {
      const res = await axios.post(`/api/workflows/${workflow.id}/run`, {
        devices: [{
          id: device.id, displayName: device.displayName, platform: device.platform, platformDeviceId: device.platformDeviceId,
          serialNumber: device.serialNumber, osVersion: device.osVersion, manufacturer: device.manufacturer, model: device.model,
          udid: device.udid, mdmUser: device.mdmUser,
        }],
      }, { headers });
      // Response returns immediately (status: 'running') — the result modal polls
      // for progress and calls onRequestRefresh once the run actually finishes.
      setRunResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to run workflow.');
    }
  }

  const segmentName = useMemo(() => {
    if (!device) return 'Global';
    const flat = flattenSegments(segmentsList);
    const match = flat.find(s => String(s.id) === String(device.segmentId));
    return match?.name || 'Global';
  }, [segmentsList, device]);

  if (!device) return null;

  async function runMutation(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.response?.data?.detail || 'That change failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleSegmentSelect(segment) {
    setActivePicker(null);
    runMutation(async () => {
      await axios.put(`/api/devices/${device.platformDeviceId}/segment`, { platform, segmentId: Number(segment.id) }, { headers });
      onDeviceUpdated({ segmentId: segment.id });
    });
  }

  function handleAddPolicy(policy) {
    setActivePicker(null);
    const updated = [...(device.activePolicies || []), { id: policy.id, name: policy.name, platform: device.platform }];
    runMutation(async () => {
      await axios.put(`/api/devices/${device.platformDeviceId}/policies`, { platform, policies: updated.map(p => ({ id: p.id, name: p.name })) }, { headers });
      onDeviceUpdated({ activePolicies: updated });
    });
  }

  function handleRemovePolicy(policyToRemove) {
    const updated = (device.activePolicies || []).filter(p => p.id !== policyToRemove.id);
    runMutation(async () => {
      await axios.put(`/api/devices/${device.platformDeviceId}/policies`, { platform, policies: updated.map(p => ({ id: p.id, name: p.name })) }, { headers });
      onDeviceUpdated({ activePolicies: updated });
    });
  }

  function handleSaveTags(tags) {
    setActivePicker(null);
    runMutation(async () => {
      await axios.put(`/api/devices/${device.platformDeviceId}/tags`, { platform, tags }, { headers });
      onDeviceUpdated({ tags });
    });
  }

  function handleSyncLocation() {
    setIsSyncingLocation(true);
    setError(null);
    axios.post('/api/analytics/locations/sync', {}, { headers })
      .then(() => onRequestRefresh())
      .catch(() => setError('Failed to sync device locations.'))
      .finally(() => setIsSyncingLocation(false));
  }

  const hwLabel = device.manufacturer ? `${device.manufacturer} ${device.model}`.trim() : device.model;
  const loc = device.location;

  return (
    <>
      <div className="fixed inset-0 z-[260] bg-black/40" onClick={onClose} />
      <div
        className="fixed inset-y-0 right-0 z-[260] w-full sm:w-[440px] shadow-2xl flex flex-col"
        style={{ backgroundColor: theme.card }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: theme.bg }}>
                <Smartphone size={20} style={{ color: theme.textMuted }} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate" style={{ color: theme.text }}>{device.displayName}</p>
                <p className="text-xs truncate" style={{ color: theme.textMuted }}>{device.platformLabel} · {hwLabel || '—'}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70 transition-opacity shrink-0" style={{ color: theme.textMuted }}>
              <X size={18} />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <ComplianceBadge
              isCompliant={device.isCompliant}
              title={device.complianceViolations?.length
                ? `Violates: ${device.complianceViolations.map(v => v.policyName || 'Unnamed policy').join(', ')}`
                : undefined}
            />
            <RiskBadge riskTier={device.riskTier} riskScore={device.riskScore} />
            {device.mdmUser?.email && (
              <span className="text-xs truncate" style={{ color: theme.textMuted }}>{device.mdmUser.email}</span>
            )}
            <button
              onClick={() => setIsPickingWorkflow(true)}
              disabled={workflows.length === 0}
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-40 shrink-0"
              style={{ backgroundColor: PRIMARY_BLUE }}
              title={workflows.length === 0 ? 'Create a workflow first, from the Workflows tab' : 'Run a workflow on this device'}
            >
              <Play size={11} /> Run workflow
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex px-5" style={{ borderBottom: `1px solid ${theme.border}` }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="relative px-3 pb-2.5 pt-3 text-sm font-medium transition-colors"
              style={{ color: tab === t.key ? PRIMARY_BLUE : theme.textMuted }}
            >
              {t.label}
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-sm"
                style={{ backgroundColor: tab === t.key ? PRIMARY_BLUE : 'transparent' }}
              />
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: `${DANGER}12`, color: DANGER, border: `1px solid ${DANGER}30` }}>
              {error}
            </div>
          )}

          {tab === 'overview' && (
            <>
              <Section title="Identifiers" theme={theme}>
                <Row label="Serial number" value={device.serialNumber} theme={theme} mono />
                <Row label="IMEI" value={device.imei} theme={theme} mono />
                <Row label="UDID" value={device.identifiers?.udid} theme={theme} mono />
                <Row label="EMM device ID" value={device.identifiers?.emmDeviceId} theme={theme} mono />
                <Row label="Windows ID" value={device.identifiers?.winId} theme={theme} mono />
              </Section>

              <Section title="Hardware & OS" theme={theme}>
                <Row label="Model" value={hwLabel} theme={theme} />
                <Row label="OS version" value={device.osVersion} theme={theme} />
                <Row label="Battery" value={device.battery != null ? `${device.battery}%` : null} theme={theme} />
                <Row label="Storage" value={device.totalStorageGb ? `${device.availableStorageGb ? device.availableStorageGb.toFixed(1) + ' GB free of ' : ''}${device.totalStorageGb.toFixed(1)} GB` : null} theme={theme} />
                <Row label="RAM" value={device.ramGb ? `${device.ramGb.toFixed(1)} GB` : null} theme={theme} />
                <Row label="State" value={device.state} theme={theme} />
                <Row label="Last seen" value={device.lastSeen ? new Date(device.lastSeen).toLocaleString() : null} theme={theme} />
              </Section>

              {device.osUpdateStatus && (
                <Section title="OS Updates" theme={theme}>
                  <Row label="Feature version" value={device.osUpdateStatus.featureLabel} theme={theme} />
                  <Row label="Current patch level" value={`.${device.osUpdateStatus.ubr}`} theme={theme} mono />
                  {device.osUpdateStatus.confidence === 'unknown' ? (
                    <p className="text-xs mt-2" style={{ color: theme.textMuted }}>
                      No confirmed patch-level comparison available yet for this Windows build — Microsoft's catalog hasn't published a build number we could match against this feature version.
                    </p>
                  ) : device.osUpdateStatus.pendingCount > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs font-medium" style={{ color: WARNING }}>
                        {device.osUpdateStatus.pendingCount} security update{device.osUpdateStatus.pendingCount === 1 ? '' : 's'} behind (latest known build .{device.osUpdateStatus.latestKnownUbr})
                      </p>
                      {device.osUpdateStatus.pendingKbs.map((kb) => (
                        <div key={kb.kb} className="px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: theme.bg }}>
                          <div className="flex items-center justify-between gap-2">
                            <span style={{ color: theme.text }}>KB{kb.kb} <span style={{ color: theme.textMuted }}>· {kb.updateType || 'Security'} update · {kb.releaseMonth}</span></span>
                            <span className="font-semibold shrink-0" style={{ color: kb.maxSeverity?.toLowerCase() === 'critical' ? DANGER : WARNING }}>
                              {kb.maxSeverity || 'Unknown'}{kb.cveCount ? ` · ${kb.cveCount} CVE${kb.cveCount === 1 ? '' : 's'}` : ''}
                            </span>
                          </div>
                          {(kb.cveIds || []).length > 0 && (
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: theme.textMuted }} title={kb.cveIds.join(', ')}>
                              {kb.cveIds.slice(0, 4).join(', ')}{kb.cveIds.length > 4 ? ` +${kb.cveIds.length - 4} more` : ''}
                            </p>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px]" style={{ color: theme.textMuted }}>
                        Security updates only — MSRC doesn't track Driver, Feature, or Quality-only updates, and Applivery reports no per-device driver inventory to compare against.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs mt-2" style={{ color: SUCCESS }}>Up to date with the latest known security update for this build.</p>
                  )}
                </Section>
              )}

              {device.osLifecycleStatus && device.osLifecycleStatus.confidence !== 'unknown' && device.osLifecycleStatus.isEol !== null && device.osLifecycleStatus.isEol !== undefined && (
                <Section title="OS Lifecycle" theme={theme}>
                  <Row label="Train" value={device.osLifecycleStatus.trainLabel} theme={theme} />
                  {device.osLifecycleStatus.isEol ? (
                    <p className="text-xs mt-2 font-medium" style={{ color: DANGER }}>
                      This OS version has reached end of life for security support{device.osLifecycleStatus.eolFrom ? ` (since ${device.osLifecycleStatus.eolFrom})` : ''}.
                      {device.osLifecycleStatus.esuUntil ? ` Paid Extended Security Updates are available until ${device.osLifecycleStatus.esuUntil}.` : ''}
                    </p>
                  ) : (
                    <p className="text-xs mt-2" style={{ color: SUCCESS }}>
                      This OS version is still within its security support window.
                      {device.osLifecycleStatus.onLatestVersion === false && device.osLifecycleStatus.latestKnownVersion
                        ? ` A newer version is available: ${device.osLifecycleStatus.latestKnownVersion}${device.osLifecycleStatus.latestKnownBuild ? ` (build ${device.osLifecycleStatus.latestKnownBuild})` : ''}.`
                        : ''}
                    </p>
                  )}
                  {device.osLifecycleStatus.latestKnownBuild && (
                    <>
                      <Row label="Latest signed build" value={device.osLifecycleStatus.latestKnownBuild} theme={theme} mono />
                      <Row label="Signed until" value={device.osLifecycleStatus.updateExpirationDate} theme={theme} />
                      <Row
                        label="Hardware match"
                        value={device.osLifecycleStatus.hardwareMatched === true ? 'Confirmed for this model' : device.osLifecycleStatus.hardwareMatched === false ? 'Unconfirmed — fleet-wide result' : null}
                        theme={theme}
                      />
                    </>
                  )}
                  {device.osLifecycleStatus.rapidSecurityResponse?.available && (
                    <div className="mt-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30` }}>
                      <p className="font-semibold" style={{ color: WARNING }}>
                        Rapid Security Response available{device.osLifecycleStatus.rapidSecurityResponse.supplementalBuildVersion ? ` (${device.osLifecycleStatus.rapidSecurityResponse.supplementalBuildVersion})` : ''}
                      </p>
                      {(device.osLifecycleStatus.rapidSecurityResponse.cveIds || []).length > 0 && (
                        <p className="mt-0.5" style={{ color: theme.textMuted }}>{device.osLifecycleStatus.rapidSecurityResponse.cveIds.join(', ')}</p>
                      )}
                    </div>
                  )}
                </Section>
              )}

              {device.vulnStatus && (
                <Section title="Vulnerabilities" theme={theme}>
                  {device.vulnStatus.confidence === 'unknown' ? (
                    <p className="text-xs" style={{ color: theme.textMuted }}>
                      No confirmed vulnerability comparison available yet for this OS version — the EUVD catalog hasn't published a parseable fixed-version match for it.
                    </p>
                  ) : device.vulnStatus.pendingCount > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium" style={{ color: WARNING }}>
                        {device.vulnStatus.pendingCount} known CVE{device.vulnStatus.pendingCount === 1 ? '' : 's'} fixed in a newer version
                      </p>
                      {device.vulnStatus.pendingCves.map((c) => (
                        <div key={c.cveId} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: theme.bg }}>
                          <span style={{ color: theme.text }}>
                            {c.cveId} <span style={{ color: theme.textMuted }}>· fixed in {c.fixedVersion || c.fixedInMajor}</span>
                          </span>
                          <span className="font-semibold shrink-0" style={{ color: c.exploited ? DANGER : (c.baseSeverity === 'Critical' ? DANGER : WARNING) }}>
                            {c.baseSeverity || 'Unknown'}{c.exploited ? ' · exploited' : ''}{typeof c.epss === 'number' ? ` · EPSS ${(c.epss * 100).toFixed(0)}%` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: SUCCESS }}>No known pending CVEs against this device's OS version.</p>
                  )}
                </Section>
              )}

              {device.vulnServiceStatus && (
                <Section title="Vulnerability Service" theme={theme}>
                  {(() => {
                    const status = device.vulnServiceStatus;
                    if (!status.checked) {
                      return status.lastCheckedAt ? (
                        <p className="text-xs" style={{ color: theme.textMuted }}>
                          Last checked {new Date(status.lastCheckedAt).toLocaleString()} — nothing conclusive was found then, and it hasn't been refreshed since. If this device is still active, check Settings &gt; Vulnerability Service for refresh errors.
                        </p>
                      ) : (
                        <p className="text-xs" style={{ color: theme.textMuted }}>
                          Not checked yet — waiting on the next scheduled refresh (Settings &gt; Vulnerability Service).
                        </p>
                      );
                    }
                    const counts = status.counts || {};
                    const total = (counts.CRITICAL || 0) + (counts.HIGH || 0) + (counts.MEDIUM || 0) + (counts.LOW || 0);
                    return total > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium" style={{ color: status.hasKev ? DANGER : WARNING }}>
                          {total} known CVE{total === 1 ? '' : 's'} across the OS and {status.appsCheckedCount} checked app{status.appsCheckedCount === 1 ? '' : 's'}
                          {status.hasKev ? ' — includes a known-exploited (CISA KEV) CVE' : ''}
                        </p>
                        {status.topCves.map((c) => (
                          <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: theme.bg }}>
                            <span style={{ color: theme.text }}>
                              {c.id} {c.fixed_in ? <span style={{ color: theme.textMuted }}>· fixed in {c.fixed_in}</span> : null}
                            </span>
                            <span className="font-semibold shrink-0" style={{ color: c.is_kev ? DANGER : (c.severity === 'CRITICAL' ? DANGER : WARNING) }}>
                              {c.severity || 'Unknown'}{c.is_kev ? ' · known-exploited' : ''}{typeof c.epss_score === 'number' ? ` · EPSS ${(c.epss_score * 100).toFixed(0)}%` : ''}
                            </span>
                          </div>
                        ))}
                        {status.uncertain > 0 && (
                          <p className="text-[10px]" style={{ color: theme.textMuted }}>
                            {status.uncertain} additional match{status.uncertain === 1 ? '' : 'es'} couldn't be confirmed against a fixed version.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: SUCCESS }}>
                        No known CVEs against this device's OS or {status.appsCheckedCount} checked app{status.appsCheckedCount === 1 ? '' : 's'}.
                      </p>
                    );
                  })()}
                  <p className="text-[10px] mt-2" style={{ color: theme.textMuted }}>
                    From your org's Vulnerability Service integration — an independent signal alongside the Vulnerability Catalog above, covering all platforms and both the OS and individual apps.
                  </p>
                </Section>
              )}

              {device.platform === 'windows' && firewallState && (
                <Section title="Firewall Rule Sets" theme={theme}>
                  {firewallState.active.length === 0 ? (
                    <p className="text-xs" style={{ color: theme.textMuted }}>No Big Picture-managed firewall rule sets currently active on this device.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {firewallState.active.map((a) => (
                        <div key={a.ruleSetId} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: theme.bg }}>
                          <span className="inline-flex items-center gap-1.5" style={{ color: theme.text }}>
                            <ShieldCheck size={12} style={{ color: WARNING }} />
                            {a.ruleSetName || a.ruleSetId}
                          </span>
                          <span className="shrink-0" style={{ color: theme.textMuted }}>
                            Applied {a.appliedAt ? new Date(a.appliedAt).toLocaleString() : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] mt-2" style={{ color: theme.textMuted }}>
                    Reflects the last Apply/Restore action dispatched from a workflow (Workflows → Firewall Policy Library) — confirms the command was sent, not a live read of the device's actual rule state. Run the matching "Restore Firewall" action to remove a rule set.
                  </p>
                </Section>
              )}

              {device.appleAppUpdateStatus && (
                <Section title="App Updates" theme={theme}>
                  {device.appleAppUpdateStatus.pendingCount > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium" style={{ color: WARNING }}>
                        {device.appleAppUpdateStatus.pendingCount} of {device.appleAppUpdateStatus.totalApps} app{device.appleAppUpdateStatus.totalApps === 1 ? '' : 's'} have an update available
                      </p>
                      {device.appleAppUpdateStatus.pendingApps.map((a) => (
                        <div key={a.identifier} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: theme.bg }}>
                          <span className="truncate" style={{ color: theme.text }}>
                            {a.name || a.identifier} {a.isBetaApp ? <span style={{ color: theme.textMuted }}>(beta)</span> : null}
                          </span>
                          <span className="font-mono shrink-0" style={{ color: theme.textMuted }}>{a.installedVersion || '—'}</span>
                        </div>
                      ))}
                      <p className="text-[10px]" style={{ color: theme.textMuted }}>
                        Straight from Apple's own App Store/VPP metadata via Applivery — "update available" here means Apple itself has published a newer version, not a version comparison we computed.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: SUCCESS }}>
                      All {device.appleAppUpdateStatus.totalApps} tracked app{device.appleAppUpdateStatus.totalApps === 1 ? '' : 's'} up to date.
                    </p>
                  )}
                </Section>
              )}

              {(device.smartAttributes || []).length > 0 && (
                <Section title="Smart Attributes" theme={theme}>
                  {device.smartAttributes.map(a => (
                    <Row key={a.name} label={a.name} value={a.value} theme={theme} />
                  ))}
                </Section>
              )}

              <Section
                title="Segment"
                theme={theme}
                action={(
                  <button onClick={() => setActivePicker('segment')} disabled={busy} className="text-xs font-medium disabled:opacity-50" style={{ color: PRIMARY_BLUE }}>
                    Change
                  </button>
                )}
              >
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: theme.bg }}>
                  <Layers size={14} style={{ color: theme.textMuted }} />
                  <span className="text-sm" style={{ color: theme.text }}>{segmentName}</span>
                </div>
              </Section>

              <Section
                title="Active Policies"
                theme={theme}
                action={(
                  <button onClick={() => setActivePicker('policy')} disabled={busy} className="inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50" style={{ color: PRIMARY_BLUE }}>
                    <Plus size={12} /> Add
                  </button>
                )}
              >
                <div className="flex flex-wrap gap-1.5">
                  {(device.activePolicies || []).map((p) => (
                    <span key={p.id || p.name} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                      {p.name}
                      <button onClick={() => handleRemovePolicy(p)} disabled={busy} className="hover:opacity-60">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {(device.activePolicies || []).length === 0 && (
                    <span className="text-xs" style={{ color: theme.textMuted }}>No policies assigned</span>
                  )}
                </div>
              </Section>

              <Section
                title="Tags"
                theme={theme}
                action={(
                  <button onClick={() => setActivePicker('tags')} disabled={busy} className="inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50" style={{ color: PRIMARY_BLUE }}>
                    <Pen size={11} /> Edit
                  </button>
                )}
              >
                <div className="flex flex-wrap gap-1.5">
                  {(device.tags || []).map(t => (
                    <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{t}</span>
                  ))}
                  {(device.tags || []).length === 0 && (
                    <span className="text-xs" style={{ color: theme.textMuted }}>No tags</span>
                  )}
                </div>
              </Section>
            </>
          )}

          {tab === 'compliance' && (
            <div>
              <Section title="Compliance Status" theme={theme}>
                <div className="flex items-center gap-2 mb-3">
                  <ComplianceBadge
                    isCompliant={device.isCompliant}
                    title={device.complianceViolations?.length
                      ? `Violates: ${device.complianceViolations.map(v => v.policyName || 'Unnamed policy').join(', ')}`
                      : undefined}
                  />
                  <RiskBadge riskTier={device.riskTier} riskScore={device.riskScore} />
                </div>
                {typeof device.riskScore === 'number' && (
                  <div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: theme.bg }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(Math.max(device.riskScore, 0), 100)}%`, backgroundColor: (RISK_TIER_META[device.riskTier] || RISK_TIER_META.low).color }}
                      />
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>Risk score {device.riskScore}/100 — higher means more attention needed.</p>
                  </div>
                )}
              </Section>

              {(device.riskFactors || []).length > 0 && (
                <Section title="Risk Factors" theme={theme}>
                  <div className="space-y-1.5">
                    {device.riskFactors.map((f, i) => (
                      <div key={i} className="flex items-center justify-between py-1 text-sm">
                        <span style={{ color: theme.text }}>{f.label}</span>
                        <span className="text-xs font-semibold" style={{ color: (RISK_TIER_META[device.riskTier] || RISK_TIER_META.low).color }}>+{f.points}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <Section title={`Compliance Policy Violations${(device.policyViolations || []).length ? ` (${device.policyViolations.length})` : ''}`} theme={theme}>
                {(device.policyViolations || []).length > 0 ? (
                  <div className="space-y-1.5">
                    {device.policyViolations.map((v, i) => (
                      <div key={v.policyId || i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: theme.bg }}>
                        <span className="truncate" style={{ color: theme.text }}>{v.policyName || 'Unknown policy'}</span>
                        <span className="text-[10px] font-semibold shrink-0 uppercase" style={{ color: v.status === 'pending' ? WARNING : v.status === 'auto_fired' ? PRIMARY_BLUE : theme.textMuted }}>
                          {String(v.status || '').replace('_', ' ') || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: SUCCESS }}>No open Compliance Policy violations for this device.</p>
                )}
              </Section>

              {(device.activeViolations || []).length > 0 && (
                <Section title={`Awaiting Review (${device.activeViolations.length})`} theme={theme}>
                  <div className="space-y-1.5">
                    {device.activeViolations.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => onOpenDeviceAudit?.(device.id, device.displayName)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors"
                        style={{ backgroundColor: theme.bg }}
                        title="View this device's history in the Audit Log"
                      >
                        <span className="truncate" style={{ color: theme.text }}>{v.policyName || 'Unknown policy'}</span>
                        <span className="text-[10px] font-semibold shrink-0" style={{ color: DANGER }}>Awaiting review →</span>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {(device.openCases || []).length > 0 && (
                <Section title={`Open Cases (${device.openCases.length})`} theme={theme}>
                  <div className="space-y-1.5">
                    {device.openCases.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => onOpenCase?.(c.id)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors"
                        style={{ backgroundColor: theme.bg }}
                        title="Open this case"
                      >
                        <span className="truncate" style={{ color: theme.text }}>{c.title}</span>
                        <span className="text-[10px] font-semibold shrink-0" style={{ color: PRIMARY_BLUE }}>{c.severity} →</span>
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {tab === 'location' && (
            <div>
              {loc ? (
                <>
                  <Section title="Last known location" theme={theme}>
                    <Row label="Latitude" value={loc.lat?.toFixed(6)} theme={theme} mono />
                    <Row label="Longitude" value={loc.lng?.toFixed(6)} theme={theme} mono />
                  </Section>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium mb-4"
                    style={{ color: PRIMARY_BLUE }}
                  >
                    <MapPin size={14} /> Open in Google Maps <ExternalLink size={12} />
                  </a>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <MapPin size={24} style={{ color: theme.textMuted }} className="mb-3" />
                  <p className="text-sm font-medium mb-1" style={{ color: theme.text }}>No location on file</p>
                  <p className="text-xs max-w-xs" style={{ color: theme.textMuted }}>Sync locations to fetch the latest known position for this fleet.</p>
                </div>
              )}
              <button
                onClick={handleSyncLocation}
                disabled={isSyncingLocation}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                <RefreshCw size={14} className={isSyncingLocation ? 'animate-spin' : ''} />
                {isSyncingLocation ? 'Syncing fleet locations…' : 'Sync fleet locations'}
              </button>
              <p className="text-[11px] mt-2" style={{ color: theme.textMuted }}>
                This refreshes GPS data for the whole fleet (one Applivery API call per device), not just this one — it can take a moment.
              </p>
            </div>
          )}
        </div>
      </div>

      {activePicker === 'segment' && (
        <SegmentPickerModal
          segments={segmentsList}
          currentSegmentId={device.segmentId}
          onSelect={handleSegmentSelect}
          onClose={() => setActivePicker(null)}
          theme={theme}
        />
      )}
      {activePicker === 'policy' && (
        <PolicyPickerModal
          platform={platform}
          apiToken={apiToken}
          orgSlug={orgSlug}
          excludeIds={(device.activePolicies || []).map(p => p.id)}
          onSelect={handleAddPolicy}
          onClose={() => setActivePicker(null)}
          theme={theme}
        />
      )}
      {activePicker === 'tags' && (
        <TagEditorModal
          initialTags={device.tags || []}
          onSave={handleSaveTags}
          onClose={() => setActivePicker(null)}
          theme={theme}
        />
      )}

      {isPickingWorkflow && (
        <WorkflowPickerModal workflows={workflows} theme={theme} onConfirm={handleRunWorkflow} onClose={() => setIsPickingWorkflow(false)} />
      )}
      {runResult && (
        <WorkflowRunResultModal
          runRecord={runResult}
          apiToken={apiToken}
          orgSlug={orgSlug}
          theme={theme}
          onClose={() => setRunResult(null)}
          onComplete={onRequestRefresh}
        />
      )}
    </>
  );
}
