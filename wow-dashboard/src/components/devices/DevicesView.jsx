import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Refresh as RefreshCw, ShieldWarning as ShieldAlert, Layers, Smartphone, Global as Globe, GraphUp as TrendIcon } from '@solar-icons/react';
import DeviceFleetTable from './DeviceFleetTable';
import DeviceDetailDrawer from './DeviceDetailDrawer';
import ViewSwitcher from '../shared/ViewSwitcher';
import HelpIcon from '../shared/HelpIcon';
import { collectSegmentIds } from '../../utils/segments';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';

// Temporary workaround while Applivery's own isCompliant flag can't yet
// consume our Compliance Policies' conditions (or any 3rd-party telemetry)
// — lets the Devices view be driven by whichever signal is more trustworthy
// right now. Persisted per-browser like the fleet table's saved filters, so
// an analyst's choice sticks across sessions.
const COMPLIANCE_SOURCE_KEY = 'huginn.devices.complianceSource';

function loadComplianceSource() {
  try {
    const v = window.localStorage.getItem(COMPLIANCE_SOURCE_KEY);
    return v === 'policy' ? 'policy' : 'applivery';
  } catch {
    return 'applivery';
  }
}

export default function DevicesView({ apiToken, orgSlug, theme, segmentsList, selectedSegment, onOpenPlayground, onOpenCase, onOpenDeviceAudit, openDeviceId }) {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [riskTrend, setRiskTrend] = useState([]);
  const [complianceSource, setComplianceSource] = useState(loadComplianceSource);
  // Scopes the "Compliance Policies" source down to devices violating one
  // specific policy — same dropdown + endpoint the Playground globe's own
  // policy filter uses (GET /api/compliance/policies and
  // GET /api/compliance/policies/{id}/violating-device-ids), so both views
  // agree on what "violating this policy" means.
  const [policies, setPolicies] = useState([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [policyViolatingIds, setPolicyViolatingIds] = useState(null); // null = no policy scope active
  const [isLoadingPolicyFilter, setIsLoadingPolicyFilter] = useState(false);

  function handleComplianceSourceChange(source) {
    setComplianceSource(source);
    try { window.localStorage.setItem(COMPLIANCE_SOURCE_KEY, source); } catch { /* storage unavailable */ }
    if (source !== 'policy') setSelectedPolicyId('');
  }

  useEffect(() => {
    if (!apiToken || !orgSlug || policies.length > 0) return;
    axios.get('/api/compliance/policies', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => setPolicies(res.data?.items || []))
      .catch(() => {});
  }, [apiToken, orgSlug, policies.length]);

  useEffect(() => {
    if (!selectedPolicyId) { setPolicyViolatingIds(null); return; }
    let cancelled = false;
    setIsLoadingPolicyFilter(true);
    axios.get(`/api/compliance/policies/${selectedPolicyId}/violating-device-ids`, {
      headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug },
    }).then(res => {
      if (!cancelled) setPolicyViolatingIds(new Set(res.data?.deviceIds || []));
    }).catch(() => { if (!cancelled) setPolicyViolatingIds(new Set()); })
      .finally(() => { if (!cancelled) setIsLoadingPolicyFilter(false); });
    return () => { cancelled = true; };
  }, [selectedPolicyId, apiToken, orgSlug]);

  const fetchDevices = useCallback(async (force) => {
    if (!apiToken || !orgSlug) return;
    if (force) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/devices', {
        params: force ? { refresh: true } : {},
        headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug },
      });
      setDevices(res.data?.items || []);
      setFetchedAt(res.data?.fetchedAt || null);
    } catch (err) {
      console.error('Failed to fetch devices:', err);
      setError(err.response?.data?.detail || 'Failed to load devices from Applivery.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [apiToken, orgSlug]);

  useEffect(() => {
    fetchDevices(false);
  }, [fetchDevices]);

  // Arrived here from an Audit Log entry's "Device: X" link — select it as
  // soon as the fleet list is in, mirroring the openCaseId pattern in
  // CasesView. Devices load fast enough (5-15min cached fleet call) that a
  // one-shot effect on `devices` populating is sufficient, no polling needed.
  useEffect(() => {
    if (!openDeviceId || devices.length === 0) return;
    const match = devices.find(d => d.id === openDeviceId);
    if (match) setSelectedDeviceId(match.id);
  }, [openDeviceId, devices]);

  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/analytics/device-risk-trend', {
      params: { days: 14 },
      headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug },
    }).then(res => setRiskTrend(res.data?.items || [])).catch(() => {});
  }, [apiToken, orgSlug]);

  // Segment filtering happens client-side against the already-cached full
  // fleet (same data /api/devices always returns) — selecting a segment in
  // the sliding panel narrows to that segment and everything beneath it,
  // matching Applivery's own Dashboard scoping rule. No extra network
  // round-trip when switching segments.
  const segmentIdSet = useMemo(() => collectSegmentIds(segmentsList, selectedSegment?.id), [segmentsList, selectedSegment]);
  const visibleDevices = useMemo(
    () => (segmentIdSet === null ? devices : devices.filter(d => segmentIdSet.has(String(d.segmentId ?? '0')))),
    [devices, segmentIdSet]
  );

  // Compliance column source — 'applivery' passes isCompliant straight
  // through untouched; 'policy' overrides it with our own Compliance
  // Policies' live violation state (device.policyViolations, attached by
  // get_devices_full from _load_compliance_state). Doing the override here,
  // once, means DeviceFleetTable/DeviceDetailDrawer need no changes — they
  // just keep reading d.isCompliant like before.
  const effectiveDevices = useMemo(() => {
    if (complianceSource !== 'policy') return visibleDevices;
    return visibleDevices.map(d => ({
      ...d,
      isCompliant: d.policyCompliant !== false,
      complianceViolations: d.policyViolations || [],
    }));
  }, [visibleDevices, complianceSource]);

  // Further scopes the table down to devices violating the selected policy
  // (Compliance Policies source only — see the dropdown next to the toggle
  // above). Device lookups elsewhere (selectedDevice, the drawer) stay
  // against the unscoped effectiveDevices so an already-open drawer isn't
  // yanked away just because the admin narrows the policy filter.
  const scopedDevices = useMemo(() => {
    if (!policyViolatingIds) return effectiveDevices;
    return effectiveDevices.filter(d => policyViolatingIds.has(String(d.id || d._id || '')));
  }, [effectiveDevices, policyViolatingIds]);

  const nonCompliant = scopedDevices.filter(d => !d.isCompliant).length;
  const selectedDevice = effectiveDevices.find(d => d.id === selectedDeviceId) || null;

  function handleDeviceUpdated(patch) {
    setDevices(prev => prev.map(d => (d.id === selectedDeviceId ? { ...d, ...patch } : d)));
  }

  function handleRequestRefresh() {
    fetchDevices(true);
  }

  return (
    <main className="p-8 pb-16 flex-1 relative overflow-y-auto">
      <header className="flex justify-between items-start mb-8">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold leading-tight" style={{ color: theme.text }}>Devices</h1>
            <HelpIcon slug="devices" theme={theme} title="Devices admin guide" />
            {selectedSegment && Number(selectedSegment.id) !== 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                <Layers size={10} /> {selectedSegment.name}
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: theme.textMuted }}>
            {isLoading
              ? 'Loading device fleet…'
              : `${scopedDevices.length} device${scopedDevices.length !== 1 ? 's' : ''}${nonCompliant ? ` · ${nonCompliant} non-compliant` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          {onOpenPlayground && (
            <ViewSwitcher
              theme={theme}
              active="devices"
              onChange={(id) => { if (id === 'playground') onOpenPlayground(); }}
              tabs={[
                { id: 'devices', label: 'Devices', Icon: Smartphone },
                { id: 'playground', label: 'Playground', Icon: Globe },
              ]}
            />
          )}
          {/* Always rendered (rather than conditionally mounted) so its
              layout space stays reserved before the first fetch resolves —
              otherwise the ViewSwitcher/Refresh button next to it would
              shift position between the loading and loaded states. */}
          <span className={`text-xs ${fetchedAt && !isLoading ? '' : 'invisible'}`} style={{ color: theme.textMuted }}>
            Updated {fetchedAt ? new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '00:00'}
          </span>
          <button
            onClick={() => fetchDevices(true)}
            disabled={isLoading || isRefreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Compliance source toggle — temporary workaround while Applivery's
          own isCompliant flag can't consume our Compliance Policies'
          conditions (or any 3rd-party telemetry). Kept as its own row below
          the header, rather than inside it, so it never competes for space
          with the ViewSwitcher/Refresh button cluster. */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="text-xs font-medium" style={{ color: theme.textMuted }}>Compliance shown:</span>
        <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
          <button
            onClick={() => handleComplianceSourceChange('applivery')}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: complianceSource === 'applivery' ? PRIMARY_BLUE : theme.card,
              color: complianceSource === 'applivery' ? '#FFFFFF' : theme.text,
              borderRight: `1px solid ${theme.border}`,
            }}
          >
            Applivery flag
          </button>
          <button
            onClick={() => handleComplianceSourceChange('policy')}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: complianceSource === 'policy' ? PRIMARY_BLUE : theme.card,
              color: complianceSource === 'policy' ? '#FFFFFF' : theme.text,
            }}
          >
            Compliance Policies
          </button>
        </div>
        {complianceSource === 'policy' && (
          <select
            value={selectedPolicyId}
            onChange={(e) => setSelectedPolicyId(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-brand-500"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            title="Scope the table to devices violating one specific Compliance Policy"
          >
            <option value="">All policies</option>
            {policies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {isLoadingPolicyFilter && (
          <span className="text-xs" style={{ color: theme.textMuted }}>Loading…</span>
        )}
        <HelpIcon slug="devices" anchor="compliance-shown-toggle" theme={theme} title="What does this toggle mean?" />
      </div>

      {riskTrend.length >= 2 && (
        <div className="flex items-center gap-3 mb-6 px-4 py-2.5 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card }}>
          <TrendIcon size={14} style={{ color: theme.textMuted }} className="shrink-0" />
          <span className="text-xs font-semibold shrink-0" style={{ color: theme.textMuted }}>Fleet risk trend</span>
          <div className="flex items-end gap-0.5 h-6 shrink-0">
            {riskTrend.map((p, i) => {
              const maxScore = Math.max(...riskTrend.map(x => x.avgRiskScore), 1);
              const heightPct = Math.max(8, (p.avgRiskScore / maxScore) * 100);
              return (
                <div
                  key={p.date}
                  title={`${p.date}: avg ${p.avgRiskScore}`}
                  className="w-1.5 rounded-sm"
                  style={{ height: `${heightPct}%`, backgroundColor: i === riskTrend.length - 1 ? PRIMARY_BLUE : `${PRIMARY_BLUE}40` }}
                />
              );
            })}
          </div>
          <span className="text-xs" style={{ color: theme.textMuted }}>
            {riskTrend[0].avgRiskScore} → {riskTrend[riskTrend.length - 1].avgRiskScore} avg over {riskTrend.length} day{riskTrend.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin mb-4"
            style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }}
          />
          <span className="text-xs uppercase tracking-widest font-bold" style={{ color: theme.textMuted }}>
            Fetching device fleet…
          </span>
        </div>
      ) : error ? (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-xl"
          style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}
        >
          <ShieldAlert size={18} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium" style={{ color: DANGER }}>Couldn't load devices</p>
            <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>{error}</p>
          </div>
        </div>
      ) : (
        <DeviceFleetTable devices={scopedDevices} theme={theme} apiToken={apiToken} orgSlug={orgSlug} onSelectDevice={(d) => setSelectedDeviceId(d.id)} segmentsList={segmentsList} />
      )}

      {selectedDevice && (
        <DeviceDetailDrawer
          device={selectedDevice}
          apiToken={apiToken}
          orgSlug={orgSlug}
          segmentsList={segmentsList}
          theme={theme}
          onClose={() => setSelectedDeviceId(null)}
          onDeviceUpdated={handleDeviceUpdated}
          onRequestRefresh={handleRequestRefresh}
          onOpenCase={onOpenCase}
          onOpenDeviceAudit={onOpenDeviceAudit}
        />
      )}
    </main>
  );
}
