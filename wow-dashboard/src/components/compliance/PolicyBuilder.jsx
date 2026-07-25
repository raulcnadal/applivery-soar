import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { CloseCircle as X, AddSquare as Plus, TrashBinMinimalistic as Trash2, ShieldCheck, Tag, UsersGroupRounded as Users, ClockCircle as Clock, Layers, Folder, DangerTriangle as AlertTriangle } from '@solar-icons/react';
import { PolicyPickerModal, AudiencePickerField, TagConditionField } from '../devices/DevicePickers';
import { useMitreCatalog, MitreTagPicker } from '../shared/MitreCatalog';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';
// Mirrors main.py's COMPLIANCE_FRAMEWORKS shortLabel — duplicated here
// rather than fetched, since this badge is read-only display and doesn't
// need the full framework catalog (caveats, description) TemplateGallery
// already fetches when it matters.
const FRAMEWORK_SHORT_LABELS = { iso27001: 'ISO 27001', ens: 'ENS', nis2: 'NIS2' };

function newConditionId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `cond-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultValueForType(type, options) {
  if (type === 'boolean') return true;
  if (type === 'select') return options?.[0] || '';
  if (type === 'number') return 0;
  if (type === 'duration') return { amount: 1, unit: 'days' };
  if (type === 'device_audience') return '';
  if (type === 'policy') return null;
  if (type === 'smart_attribute') return { name: '', compareValue: '' };
  if (type === 'self_reported_attribute') return { name: '', compareValue: '' };
  if (type === 'custom_field') return { path: '', compareValue: '' };
  if (type === 'app_list') return '';
  return '';
}

const OPERATOR_LABEL = {
  equals: 'is', notEquals: 'is not', greaterThan: 'is more than', lessThan: 'is less than',
  includes: 'has', excludes: "doesn't have", missing: 'is missing', contains: 'contains', exists: 'exists',
};

const PLATFORMS = ['apple', 'macos', 'android', 'windows'];

function ConditionRow({ condition, fieldsCatalog, smartAttributeNames, selfReportedAttributeNames, appLists, deviceAudiences, onAudienceCreated, deviceTags, segments, apiToken, orgSlug, theme, onChange, onRemove }) {
  const [isPickingPolicy, setIsPickingPolicy] = useState(false);
  const fieldDef = fieldsCatalog.find(f => f.key === condition.field) || fieldsCatalog[0];
  const needsCompareValue = !['exists', 'missing'].includes(condition.operator);

  function setField(key) {
    const def = fieldsCatalog.find(f => f.key === key);
    onChange({ field: key, operator: def?.operators?.[0] || 'equals', value: defaultValueForType(def?.type, def?.options) });
  }

  function setPolicyPlatform(platform) {
    onChange({ ...condition, value: { ...(condition.value || {}), platform, policyId: null, policyName: null } });
  }

  return (
    <div className="rounded-xl p-3 mb-2" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 grid grid-cols-2 gap-2">
          <select
            value={fieldDef?.key || ''}
            onChange={(e) => setField(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            {fieldsCatalog.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select
            value={condition.operator}
            onChange={(e) => onChange({ ...condition, operator: e.target.value })}
            className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            {(fieldDef?.operators || []).map(op => <option key={op} value={op}>{OPERATOR_LABEL[op] || op}</option>)}
          </select>
        </div>
        <button onClick={onRemove} className="p-1.5 rounded shrink-0" style={{ color: DANGER }}><Trash2 size={13} /></button>
      </div>

      <div className="mt-2">
        {fieldDef?.type === 'boolean' && (
          <select
            value={String(condition.value)}
            onChange={(e) => onChange({ ...condition, value: e.target.value === 'true' })}
            className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            {fieldDef.key === 'isCompliant' ? (
              <>
                <option value="true">Compliant</option>
                <option value="false">Non-compliant</option>
              </>
            ) : (
              <>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </>
            )}
          </select>
        )}

        {fieldDef?.type === 'select' && (
          <select
            value={condition.value || ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            {(fieldDef.options || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}

        {fieldDef?.type === 'number' && (
          <input
            type="number"
            value={condition.value ?? 0}
            onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
        )}

        {fieldDef?.type === 'duration' && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={condition.value?.amount ?? 1}
              onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), amount: Number(e.target.value) } })}
              className="w-24 px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
            <select
              value={condition.value?.unit || 'days'}
              onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), unit: e.target.value } })}
              className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
        )}

        {fieldDef?.type === 'device_audience' && (
          <AudiencePickerField
            value={condition.value}
            audiences={deviceAudiences}
            onSelect={(id) => onChange({ ...condition, value: id })}
            onCreated={onAudienceCreated}
            apiToken={apiToken}
            orgSlug={orgSlug}
            theme={theme}
          />
        )}

        {fieldDef?.type === 'string' && fieldDef.key === 'segmentId' && (
          <select
            value={condition.value || ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">{(segments || []).length ? 'Select a Segment…' : 'No Segments found'}</option>
            {(segments || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {fieldDef?.type === 'string' && fieldDef.key === 'tags' && (
          <TagConditionField
            value={condition.value}
            availableTags={deviceTags}
            onSelect={(v) => onChange({ ...condition, value: v })}
            theme={theme}
          />
        )}

        {fieldDef?.type === 'string' && fieldDef.key !== 'segmentId' && fieldDef.key !== 'tags' && (
          <input
            value={condition.value || ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder="Value…"
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
        )}

        {fieldDef?.type === 'smart_attribute' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              list="smart-attribute-names"
              value={condition.value?.name || ''}
              onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), name: e.target.value } })}
              placeholder="Attribute name, e.g. PatchLevel"
              className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
            <datalist id="smart-attribute-names">
              {(smartAttributeNames || []).map(n => <option key={n} value={n} />)}
            </datalist>
            {needsCompareValue && (
              <input
                value={condition.value?.compareValue ?? ''}
                onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), compareValue: e.target.value } })}
                placeholder="Expected value…"
                className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              />
            )}
          </div>
        )}

        {fieldDef?.type === 'self_reported_attribute' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              list="self-reported-attribute-names"
              value={condition.value?.name || ''}
              onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), name: e.target.value } })}
              placeholder={(selfReportedAttributeNames || []).length ? 'Pick or type an attribute…' : 'Attribute name, e.g. diskEncryptionEnabled'}
              className="px-2 py-1.5 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
            <datalist id="self-reported-attribute-names">
              {(selfReportedAttributeNames || []).map(n => <option key={n} value={n} />)}
            </datalist>
            {needsCompareValue && (
              <input
                value={condition.value?.compareValue ?? ''}
                onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), compareValue: e.target.value } })}
                placeholder="Expected value…"
                className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              />
            )}
            {selfReportedAttributeNames.length === 0 && (
              <p className="text-[10px] w-full" style={{ color: theme.textMuted }}>No devices have reported yet — once one does, its field names appear here automatically.</p>
            )}
          </div>
        )}

        {fieldDef?.type === 'custom_field' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={condition.value?.path || ''}
              onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), path: e.target.value } })}
              placeholder="Field path, e.g. identifiers.udid"
              className="px-2 py-1.5 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
            {needsCompareValue && (
              <input
                value={condition.value?.compareValue ?? ''}
                onChange={(e) => onChange({ ...condition, value: { ...(condition.value || {}), compareValue: e.target.value } })}
                placeholder="Expected value…"
                className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              />
            )}
          </div>
        )}

        {fieldDef?.type === 'policy' && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={condition.value?.platform || ''}
              onChange={(e) => setPolicyPlatform(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              <option value="">Platform…</option>
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {condition.value?.platform && (
              condition.value?.policyId ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                  <ShieldCheck size={12} /> {condition.value.policyName}
                  <button onClick={() => onChange({ ...condition, value: { ...condition.value, policyId: null, policyName: null } })} className="hover:opacity-60">
                    <X size={11} />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setIsPickingPolicy(true)}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium"
                  style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                >
                  <Plus size={12} /> Choose policy
                </button>
              )
            )}
            {isPickingPolicy && (
              <PolicyPickerModal
                platform={condition.value?.platform}
                apiToken={apiToken}
                orgSlug={orgSlug}
                excludeIds={[]}
                theme={theme}
                onClose={() => setIsPickingPolicy(false)}
                onSelect={(p) => {
                  setIsPickingPolicy(false);
                  onChange({ ...condition, value: { ...condition.value, policyId: p.id, policyName: p.name } });
                }}
              />
            )}
          </div>
        )}

        {fieldDef?.type === 'app_list' && (
          <div>
            <select
              value={condition.value || ''}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              <option value="">{(appLists || []).length ? 'Select an App List…' : 'No App Lists yet — add one from the App Lists button above'}</option>
              {(appLists || []).map(l => (
                <option key={l.id} value={l.id}>{l.name} ({l.platform})</option>
              ))}
            </select>
            <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>
              Only matches devices on the list's platform — pair with a "Platform" condition if this policy also covers other platforms.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PolicyBuilder({ policy, apiToken, orgSlug, theme, onClose, onSaved, defaultSegment }) {
  const [name, setName] = useState(policy?.name || '');
  const [description, setDescription] = useState(policy?.description || '');
  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [autoRun, setAutoRun] = useState(policy?.autoRun ?? false);
  // New policies are internally assigned to whichever Segment is selected in
  // the sliding panel at creation time (default Global/0) — editing an
  // existing policy keeps its already-assigned segment untouched unless the
  // admin explicitly changes it below. Per Applivery's own Segment model
  // this is an administrative/visibility scope, not a device-targeting
  // filter — "Apply to devices" (Device Audience) below is what actually
  // narrows which devices get evaluated.
  const [segmentId, setSegmentId] = useState(() => {
    if (policy?.segmentId !== undefined && policy?.segmentId !== null) return Number(policy.segmentId);
    return defaultSegment && Number(defaultSegment.id) !== 0 ? Number(defaultSegment.id) : 0;
  });
  const [conditionLogic, setConditionLogic] = useState(policy?.conditionLogic || 'any');
  const [conditions, setConditions] = useState(policy?.conditions || []);
  const [workflowId, setWorkflowId] = useState(policy?.workflowId || '');
  const [autoRunBatchCap, setAutoRunBatchCap] = useState(policy?.autoRunBatchCap ?? 15);
  // autoRunBatchCap === null means "no limit" (see CompliancePolicyPayload.
  // autoRunBatchCap on the backend) — tracked as its own toggle rather than
  // overloading the number field with a magic value, so the number input
  // can keep a sane last-known number in it if the admin flips this off
  // again rather than snapping to some arbitrary default.
  const [noBatchCap, setNoBatchCap] = useState(policy?.autoRunBatchCap === null);
  const [autoRunDestructiveAck, setAutoRunDestructiveAck] = useState(policy?.autoRunDestructiveAck ?? false);
  const [escalatedWorkflowId, setEscalatedWorkflowId] = useState(policy?.escalatedWorkflowId || '');
  const [escalatedWorkflowMinRiskTier, setEscalatedWorkflowMinRiskTier] = useState(policy?.escalatedWorkflowMinRiskTier || 'high');
  const [mdmActions, setMdmActions] = useState([]);
  const [nonComplianceTag, setNonComplianceTag] = useState(policy?.nonComplianceTag || '');
  const [nonComplianceSmartAttributeId, setNonComplianceSmartAttributeId] = useState(policy?.nonComplianceSmartAttributeId || '');
  const [openCaseOnViolation, setOpenCaseOnViolation] = useState(policy?.openCaseOnViolation ?? true);
  const [autoResolveCaseOnRecovery, setAutoResolveCaseOnRecovery] = useState(policy?.autoResolveCaseOnRecovery ?? false);
  const [mitreTechniques, setMitreTechniques] = useState(policy?.mitreTechniques || []);
  // Framework/controlRef aren't editable here — they're set once, either by
  // TemplateGallery when this draft came from a Compliance Policy Template,
  // or left null for a hand-built policy. Carried through untouched on save
  // so the framework-scoped report widgets can find this policy later; see
  // the badge below for the only UI this surfaces.
  const [templateFramework] = useState(policy?.framework || null);
  const [templateControlRef] = useState(policy?.controlRef || null);
  const mitreCatalog = useMitreCatalog(apiToken, orgSlug);
  const [targetDeviceAudienceId, setTargetDeviceAudienceId] = useState(policy?.targetDeviceAudienceId || '');
  const initialIntervalMinutes = policy?.evaluationIntervalMinutes ?? null;
  const [evalUnit, setEvalUnit] = useState(initialIntervalMinutes && initialIntervalMinutes % 60 === 0 ? 'hours' : 'minutes');
  const [evalAmount, setEvalAmount] = useState(
    initialIntervalMinutes == null ? '' : (initialIntervalMinutes % 60 === 0 ? initialIntervalMinutes / 60 : initialIntervalMinutes)
  );
  const [fieldsCatalog, setFieldsCatalog] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [smartAttributeNames, setSmartAttributeNames] = useState([]);
  const [selfReportedAttributeNames, setSelfReportedAttributeNames] = useState([]);
  const [deviceAudiences, setDeviceAudiences] = useState([]);
  const [deviceTags, setDeviceTags] = useState([]);
  const [segments, setSegments] = useState([]);
  const [smartAttributes, setSmartAttributes] = useState([]);
  const [appLists, setAppLists] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  // Non-binding MITRE suggestions derived from the conditions currently on
  // this draft — see COMPLIANCE_FIELD_MITRE_HINTS in main.py. Purely an
  // assist; the admin clicks one to add it to mitreTechniques, nothing here
  // is auto-applied.
  const [suggestedMitreTechniques, setSuggestedMitreTechniques] = useState([]);
  // "Devices that will receive this policy" preview — see
  // GET /api/device-audiences/{id}/matched-devices. Answers, before saving,
  // whether the selected Device Audience actually resolves to the devices
  // an admin expects (this is what confirms the audience linkage is
  // actually working end to end, not just that a name was picked).
  const [matchedDevices, setMatchedDevices] = useState(null);
  const [matchedDevicesLoading, setMatchedDevicesLoading] = useState(false);
  const [matchedDevicesError, setMatchedDevicesError] = useState(null);
  // Populated by the backend only when it found zero matched devices — a
  // direct, live readout of what Applivery's own API actually returned for
  // this one audience, so a permissions issue, a genuinely empty audience,
  // and an id-resolution bug are each visibly distinguishable instead of
  // all looking like the same "0 devices" dead end.
  const [matchedDevicesDiagnostics, setMatchedDevicesDiagnostics] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  useEffect(() => {
    axios.get('/api/compliance/fields', { headers }).then(res => setFieldsCatalog(res.data?.items || [])).catch(() => {});
    axios.get('/api/workflows', { headers }).then(res => setWorkflows(res.data?.items || [])).catch(() => {});
    axios.get('/api/mdm-actions', { headers }).then(res => setMdmActions(res.data?.items || [])).catch(() => {});
    axios.get('/api/compliance/smart-attribute-names', { headers }).then(res => setSmartAttributeNames(res.data?.items || [])).catch(() => {});
    axios.get('/api/compliance/self-reported-attribute-names', { headers }).then(res => setSelfReportedAttributeNames(res.data?.items || [])).catch(() => {});
    axios.get('/api/device-audiences', { headers }).then(res => setDeviceAudiences(res.data?.items || [])).catch(() => {});
    axios.get('/api/device-tags', { headers }).then(res => setDeviceTags(res.data?.items || [])).catch(() => {});
    axios.get('/api/segments', { headers }).then(res => setSegments(res.data?.items || [])).catch(() => {});
    axios.get('/api/smart-attributes', { headers }).then(res => setSmartAttributes(res.data?.items || [])).catch(() => {});
    axios.get('/api/app-lists', { headers }).then(res => setAppLists(res.data?.items || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh MITRE suggestions as conditions change, debounced so we're not
  // firing a request per keystroke while an admin is still mid-edit on a
  // condition's value.
  useEffect(() => {
    if (!conditions || conditions.length === 0) { setSuggestedMitreTechniques([]); return; }
    const timer = setTimeout(() => {
      axios.post('/api/compliance/suggest-mitre-techniques', { conditions }, { headers })
        .then(res => setSuggestedMitreTechniques(res.data?.items || []))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditions]);

  // Refresh the matched-devices preview whenever the target Device Audience
  // changes — this is what lets an admin catch a misconfigured/empty
  // audience before saving, instead of discovering it later via a
  // suspiciously quiet Compliance Policy.
  useEffect(() => {
    if (!targetDeviceAudienceId) { setMatchedDevices(null); setMatchedDevicesError(null); setMatchedDevicesDiagnostics(null); return; }
    let cancelled = false;
    setMatchedDevicesLoading(true);
    setMatchedDevicesError(null);
    axios.get(`/api/device-audiences/${targetDeviceAudienceId}/matched-devices`, { headers })
      .then(res => {
        if (cancelled) return;
        setMatchedDevices(res.data?.items || []);
        setMatchedDevicesDiagnostics(res.data?.diagnostics || null);
      })
      .catch(() => { if (!cancelled) setMatchedDevicesError('Could not load matched devices.'); })
      .finally(() => { if (!cancelled) setMatchedDevicesLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDeviceAudienceId]);

  function handleAudienceCreated(aud) {
    setDeviceAudiences(list => [...list, aud]);
  }

  function addCondition() {
    const def = fieldsCatalog[0];
    if (!def) return;
    setConditions([...conditions, { id: newConditionId(), field: def.key, operator: def.operators[0], value: defaultValueForType(def.type, def.options) }]);
  }

  function updateCondition(index, updated) {
    setConditions(conditions.map((c, i) => (i === index ? { ...updated, id: c.id } : c)));
  }

  function removeCondition(index) {
    setConditions(conditions.filter((_, i) => i !== index));
  }

  // Mirrors _workflow_has_destructive_step on the backend — same source of
  // truth (MDM_ACTIONS' own 'destructive' flag, via /api/mdm-actions), just
  // evaluated client-side so the warning shows up before a save round-trip.
  const mdmActionsByKey = useMemo(() => Object.fromEntries(mdmActions.map(a => [a.key, a])), [mdmActions]);
  const selectedWorkflow = workflows.find(w => w.id === workflowId);
  const selectedEscalatedWorkflow = workflows.find(w => w.id === escalatedWorkflowId);
  const workflowIsDestructive = (wf) => !!wf && (wf.steps || []).some(
    s => s.type === 'mdm_action' && mdmActionsByKey[s.config?.action]?.destructive
  );
  const isDestructiveWorkflow = workflowIsDestructive(selectedWorkflow);
  const isDestructiveEscalatedWorkflow = workflowIsDestructive(selectedEscalatedWorkflow);
  const destructiveWorkflowName = isDestructiveWorkflow ? selectedWorkflow?.name : (isDestructiveEscalatedWorkflow ? selectedEscalatedWorkflow?.name : null);

  async function handleSave() {
    if (!name.trim()) { setError('Give this policy a name.'); return; }
    if (conditions.length === 0) { setError('Add at least one condition to watch.'); return; }
    if (!workflowId) { setError('Link a workflow to run when this policy is violated.'); return; }
    if (autoRun && (isDestructiveWorkflow || isDestructiveEscalatedWorkflow) && !autoRunDestructiveAck) {
      setError(`"${destructiveWorkflowName}" includes a destructive action — check the acknowledgment below to enable autoRun with it.`);
      return;
    }

    let evaluationIntervalMinutes = null;
    if (evalAmount !== '') {
      const minutes = Math.round(Number(evalAmount) * (evalUnit === 'hours' ? 60 : 1));
      if (!Number.isFinite(minutes) || minutes < 60 || minutes > 1440) {
        setError('Evaluation frequency must be between 1 hour and 24 hours.');
        return;
      }
      evaluationIntervalMinutes = minutes;
    }

    setIsSaving(true);
    setError(null);
    const body = {
      name, description, enabled, autoRun, conditionLogic,
      conditions: conditions.map(({ field, operator, value }) => ({ field, operator, value })),
      workflowId,
      autoRunBatchCap: noBatchCap ? null : (Number.isFinite(Number(autoRunBatchCap)) && Number(autoRunBatchCap) > 0 ? Number(autoRunBatchCap) : 15),
      autoRunDestructiveAck,
      escalatedWorkflowId: escalatedWorkflowId || null,
      escalatedWorkflowMinRiskTier,
      nonComplianceTag: nonComplianceTag.trim() || null,
      nonComplianceSmartAttributeId: nonComplianceSmartAttributeId || null,
      openCaseOnViolation, autoResolveCaseOnRecovery,
      mitreTechniques,
      targetDeviceAudienceId: targetDeviceAudienceId || null,
      segmentId: Number.isFinite(Number(segmentId)) ? Number(segmentId) : 0,
      evaluationIntervalMinutes,
      framework: templateFramework,
      controlRef: templateControlRef,
    };
    try {
      const res = policy?.id
        ? await axios.put(`/api/compliance/policies/${policy.id}`, body, { headers })
        : await axios.post('/api/compliance/policies', body, { headers });
      onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save policy.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[270] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: theme.card, maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold" style={{ color: theme.text }}>{policy ? 'Edit Compliance Policy' : 'Create Compliance Policy'}</h3>
            {templateFramework && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: '#0241E312', color: '#0241E3' }}
                title="This policy was created from a Compliance Policy Template and stays tagged to it for framework reporting — see Reporting > Widget Builder."
              >
                {(FRAMEWORK_SHORT_LABELS[templateFramework] || templateFramework)}{templateControlRef ? ` — ${templateControlRef}` : ''}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 shrink-0" style={{ color: theme.textMuted }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: `${DANGER}12`, color: DANGER, border: `1px solid ${DANGER}30` }}>
              {error}
            </div>
          )}

          <div className="space-y-2 mb-5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Policy name, e.g. Stale or non-compliant devices"
              className="w-full px-3 py-2 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            />
          </div>

          {policy?.autoRunTripped && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg mb-4" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
              <AlertTriangle size={15} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold" style={{ color: DANGER }}>autoRun is currently tripped</p>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: theme.textMuted }}>{policy.autoRunTrippedReason || 'Repeated failures paused autoRun for this policy.'} Saving this policy will re-arm autoRun.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-5">
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer" style={{ border: `1px solid ${theme.border}` }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span style={{ color: theme.text }}>Enabled</span>
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer" style={{ border: `1px solid ${theme.border}` }}>
              <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
              <span style={{ color: theme.text }}>Auto-run workflow (skip review queue)</span>
            </label>
          </div>

          {autoRun && (
            <div className="mb-5 p-3 rounded-lg" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>autoRun safety limits</p>
              <label className="block text-xs mb-1" style={{ color: theme.text }}>Max devices auto-fired per evaluation pass</label>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={autoRunBatchCap}
                  disabled={noBatchCap}
                  onChange={(e) => setAutoRunBatchCap(e.target.value)}
                  className="w-28 px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all disabled:opacity-40"
                  style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
                />
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: theme.text }}>
                  <input type="checkbox" checked={noBatchCap} onChange={(e) => setNoBatchCap(e.target.checked)} />
                  No limit
                </label>
              </div>
              <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
                {noBatchCap
                  ? 'Every violating device in a pass fires unattended, with no cap and nothing queued for review — only turn this on for a workflow you\'d be comfortable running against the whole fleet at once.'
                  : 'If more than this many devices violate in a single pass, the rest are queued for manual review instead of firing unattended.'}
              </p>
              {noBatchCap && (
                <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg mt-2" style={{ backgroundColor: `${WARNING}12`, border: `1px solid ${WARNING}30` }}>
                  <AlertTriangle size={13} style={{ color: WARNING }} className="shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed" style={{ color: theme.textMuted }}>
                    A bad condition, a stale sync, or an entire Device Audience flipping non-compliant at once will now fire this policy's workflow against every one of them in the same pass, unattended.
                  </p>
                </div>
              )}

              {(isDestructiveWorkflow || isDestructiveEscalatedWorkflow) && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg mt-3" style={{ backgroundColor: `${DANGER}10`, border: `1px solid ${DANGER}30` }}>
                  <AlertTriangle size={15} style={{ color: DANGER }} className="shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold" style={{ color: DANGER }}>"{destructiveWorkflowName}" includes a destructive action</p>
                    <p className="text-[11px] mt-0.5 mb-2 leading-relaxed" style={{ color: theme.textMuted }}>
                      Enabling autoRun means this fires unattended against every violating device (or every escalated one), with no human review, the moment they're detected.
                    </p>
                    <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: theme.text }}>
                      <input type="checkbox" checked={autoRunDestructiveAck} onChange={(e) => setAutoRunDestructiveAck(e.target.checked)} />
                      I understand and want autoRun to fire this unattended
                    </label>
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${theme.border}` }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: theme.textMuted }}>Escalate on high-risk devices (optional)</p>
                <p className="text-[11px] mb-2 leading-relaxed" style={{ color: theme.textMuted }}>
                  Run a different, tougher workflow instead of the one above when the violating device's own risk tier is already at or above the threshold — e.g. notify on a low-risk device, but quarantine one that's already critical.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={escalatedWorkflowId}
                    onChange={(e) => setEscalatedWorkflowId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
                  >
                    <option value="">No escalation — always run the default workflow</option>
                    {workflows.filter(w => w.id !== workflowId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  {escalatedWorkflowId && (
                    <select
                      value={escalatedWorkflowMinRiskTier}
                      onChange={(e) => setEscalatedWorkflowMinRiskTier(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
                    >
                      <option value="medium">At risk tier: Medium or above</option>
                      <option value="high">At risk tier: High or above</option>
                      <option value="critical">At risk tier: Critical only</option>
                    </select>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <Layers size={12} /> Segment
            </p>
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            >
              <option value={0}>Global</option>
              {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
              Which Segment owns this policy administratively — matches whatever was selected in the segment panel when you clicked "Create". This doesn't by itself limit which devices are checked; use "Apply to devices" further down for that.
            </p>
          </div>

          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <Clock size={12} /> Evaluation frequency
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={evalAmount}
                onChange={(e) => setEvalAmount(e.target.value)}
                placeholder="Default"
                className="w-28 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              />
              <select
                value={evalUnit}
                onChange={(e) => setEvalUnit(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
              </select>
              {evalAmount !== '' && (
                <button
                  onClick={() => setEvalAmount('')}
                  className="text-xs font-medium"
                  style={{ color: theme.textMuted }}
                >
                  Reset to default
                </button>
              )}
            </div>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
              How often the background scheduler automatically re-checks this policy. Leave blank to use the org
              default (60 minutes). Must be between 1 hour and 24 hours — evaluating faster doesn't add real
              freshness (device state doesn't change that fast) and protects the Applivery API from being polled
              too aggressively across all your policies combined. "Evaluate now" always runs immediately regardless
              of this setting.
            </p>
          </div>

          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Watch for</p>
            <div className="flex items-center gap-2">
              <select
                value={conditionLogic}
                onChange={(e) => setConditionLogic(e.target.value)}
                className="px-2 py-1 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              >
                <option value="any">Match ANY condition</option>
                <option value="all">Match ALL conditions</option>
              </select>
              <button onClick={addCondition} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: PRIMARY_BLUE }}>
                <Plus size={12} /> Add condition
              </button>
            </div>
          </div>

          {conditions.length === 0 && (
            <p className="text-xs text-center py-8" style={{ color: theme.textMuted }}>No conditions yet — add one to define what "out of compliance" means.</p>
          )}

          {conditions.map((c, i) => (
            <ConditionRow
              key={c.id}
              condition={c}
              fieldsCatalog={fieldsCatalog}
              smartAttributeNames={smartAttributeNames}
              selfReportedAttributeNames={selfReportedAttributeNames}
              appLists={appLists}
              deviceAudiences={deviceAudiences}
              onAudienceCreated={handleAudienceCreated}
              deviceTags={deviceTags}
              segments={segments}
              apiToken={apiToken}
              orgSlug={orgSlug}
              theme={theme}
              onChange={(updated) => updateCondition(i, updated)}
              onRemove={() => removeCondition(i)}
            />
          ))}

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>Then run</p>
            <select
              value={workflowId}
              onChange={(e) => {
                // Default (not force) the acknowledgment checkbox to match
                // the newly-picked workflow's own author-declared default —
                // still a fully independent, visible, editable checkbox;
                // this just picks its starting value on each new selection
                // instead of always starting unchecked. See WorkflowBuilder
                // .jsx's allowUnattendedDestructive toggle.
                const picked = workflows.find(w => w.id === e.target.value);
                setWorkflowId(e.target.value);
                setAutoRunDestructiveAck(!!picked?.allowUnattendedDestructive);
              }}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            >
              <option value="">Select a workflow…</option>
              {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {workflows.length === 0 && (
              <p className="text-xs mt-1" style={{ color: theme.textMuted }}>No workflows yet — create one from the Workflows tab first.</p>
            )}
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>Mark on Applivery console</p>
            <div className="relative">
              <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: theme.textMuted }} />
              <input
                value={nonComplianceTag}
                onChange={(e) => setNonComplianceTag(e.target.value)}
                placeholder="Tag applied while violated, e.g. non-compliant:stale-os (optional)"
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              />
            </div>
            <p className="text-[11px] mt-1.5 mb-3 leading-relaxed" style={{ color: theme.textMuted }}>
              Tag applied to a device the moment this policy is newly violated, removed automatically once it recovers.
            </p>

            <select
              value={nonComplianceSmartAttributeId}
              onChange={(e) => setNonComplianceSmartAttributeId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            >
              <option value="">{(smartAttributes || []).length ? 'No Smart Attribute (optional)' : 'No Smart Attributes found'}</option>
              {(smartAttributes || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
              Create the Smart Attribute once in Applivery (Automation → Smart Attributes), then pick it here. We attach
              it to the device while this policy is violated and detach it on recovery — that's the only part of a Smart
              Attribute Applivery's public API lets us write per device; it can't set a custom value on it. Tag and Smart
              Attribute are independent — use either, both, or neither, and give each policy its own tag/attribute rather
              than sharing one across policies.
            </p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <Folder size={12} /> Case Management
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer" style={{ border: `1px solid ${theme.border}` }}>
                <input type="checkbox" checked={openCaseOnViolation} onChange={(e) => setOpenCaseOnViolation(e.target.checked)} />
                <span style={{ color: theme.text }}>Open a Case when this policy is violated</span>
              </label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer" style={{ border: `1px solid ${theme.border}`, opacity: openCaseOnViolation ? 1 : 0.5 }}>
                <input type="checkbox" checked={autoResolveCaseOnRecovery} disabled={!openCaseOnViolation} onChange={(e) => setAutoResolveCaseOnRecovery(e.target.checked)} />
                <span style={{ color: theme.text }}>Auto-resolve the Case once the device recovers</span>
              </label>
            </div>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
              Cases are the incident layer above raw violations — status, assignee, notes, timeline. Turning "Open a Case" off keeps this policy's violations out of the Cases queue entirely; approving or dismissing a violation from the review queue still works either way. With Case-opening on, leave auto-resolve off (default) so an analyst confirms the fix before closing it — turn it on for policies covering flaky/transient conditions that reliably self-heal, where a lingering open case just adds noise.
            </p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>MITRE ATT&CK Tagging</p>
            {suggestedMitreTechniques.filter(t => !mitreTechniques.includes(t.id)).length > 0 && (
              <div className="mb-2 p-2 rounded-lg" style={{ border: `1px dashed ${theme.border}`, backgroundColor: theme.bg }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: theme.textMuted }}>
                  Suggested from your conditions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedMitreTechniques.filter(t => !mitreTechniques.includes(t.id)).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMitreTechniques([...mitreTechniques, t.id])}
                      title={`Suggested because of: ${t.triggeredByFields?.join(', ')}`}
                      className="inline-flex items-center gap-1 rounded-full font-semibold text-[10px] px-2 py-1 transition-colors"
                      style={{ backgroundColor: `${mitreCatalog.tacticColor[t.tactic] || '#64748B'}15`, color: mitreCatalog.tacticColor[t.tactic] || '#64748B' }}
                    >
                      <Plus size={10} /> {t.id} · {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <MitreTagPicker
              techniques={mitreCatalog.techniques}
              tactics={mitreCatalog.tactics}
              tacticColor={mitreCatalog.tacticColor}
              selected={mitreTechniques}
              onChange={setMitreTechniques}
              theme={theme}
              catalogMeta={mitreCatalog.catalogMeta}
              onRefreshCatalog={mitreCatalog.refreshCatalogNow}
            />
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
              Classify what this policy detects against the ATT&CK Enterprise matrix — carried onto every Case this policy opens, purely for triage/reporting; has no effect on evaluation.
            </p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <Users size={12} /> Apply to devices
            </p>
            <AudiencePickerField
              value={targetDeviceAudienceId}
              audiences={deviceAudiences}
              onSelect={setTargetDeviceAudienceId}
              onCreated={handleAudienceCreated}
              apiToken={apiToken}
              orgSlug={orgSlug}
              theme={theme}
            />
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
              Leave blank to evaluate this policy against every device in the fleet. Pick a Device Audience to scope
              it — only devices currently in that audience are checked; membership is re-resolved every run, so it
              stays in sync as the audience's selectors match different devices over time.
            </p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
              <Layers size={12} /> Devices that will receive this policy
            </p>
            {!targetDeviceAudienceId && (
              <div className="rounded-lg px-3 py-2.5 text-xs" style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}>
                No Device Audience selected above — this policy applies to every device in the fleet.
              </div>
            )}
            {targetDeviceAudienceId && matchedDevicesLoading && (
              <div className="rounded-lg px-3 py-2.5 text-xs" style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}>
                Checking which devices currently belong to this audience…
              </div>
            )}
            {targetDeviceAudienceId && !matchedDevicesLoading && matchedDevicesError && (
              <div className="rounded-lg px-3 py-2.5 text-xs" style={{ border: `1px solid ${DANGER}40`, backgroundColor: `${DANGER}10`, color: DANGER }}>
                {matchedDevicesError}
              </div>
            )}
            {targetDeviceAudienceId && !matchedDevicesLoading && !matchedDevicesError && matchedDevices && (
              <div className="rounded-lg" style={{ border: `1px solid ${matchedDevices.length === 0 ? `${WARNING}60` : theme.border}` }}>
                <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: matchedDevices.length ? `1px solid ${theme.border}` : 'none' }}>
                  <span className="text-xs font-semibold" style={{ color: matchedDevices.length === 0 ? WARNING : theme.text }}>
                    {matchedDevices.length === 0
                      ? 'No devices currently match this audience'
                      : `${matchedDevices.length} device${matchedDevices.length === 1 ? '' : 's'} match this audience right now`}
                  </span>
                </div>
                {matchedDevices.length === 0 && (
                  <div className="px-3 pb-2.5">
                    <p className="text-[11px] leading-relaxed" style={{ color: theme.textMuted }}>
                      This policy will have nothing to evaluate until a device matches. Double-check the audience's
                      selectors in Applivery (Device Management → Device Audiences), or pick a different audience above.
                    </p>
                    {matchedDevicesDiagnostics && (
                      <div className="mt-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed" style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}>
                        <p className="font-semibold mb-1" style={{ color: theme.text }}>What Applivery's API returned just now</p>
                        {matchedDevicesDiagnostics.error ? (
                          <p style={{ color: DANGER }}>
                            HTTP {matchedDevicesDiagnostics.httpStatus ?? 'error'} — {matchedDevicesDiagnostics.error}
                            {matchedDevicesDiagnostics.httpStatus === 401 || matchedDevicesDiagnostics.httpStatus === 403
                              ? ' — likely a permissions issue on the API token (needs mdm.global.deviceAudience.view).'
                              : ''}
                          </p>
                        ) : matchedDevicesDiagnostics.rawMemberCount > 0 ? (
                          <>
                            <p style={{ color: WARNING }}>
                              Applivery returned {matchedDevicesDiagnostics.rawMemberCount} raw member{matchedDevicesDiagnostics.rawMemberCount === 1 ? '' : 's'} for this audience, but none matched a known device — this points at an id-resolution bug, not a misconfigured audience.
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {matchedDevicesDiagnostics.rawMembers.slice(0, 5).map(m => (
                                <li key={m.id} style={{ color: theme.textMuted }}>{m.displayName || m.id} <span className="font-mono">({m.platformKey}: {m.id})</span></li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p style={{ color: theme.textMuted }}>
                            Applivery returned HTTP {matchedDevicesDiagnostics.httpStatus} with zero members for this audience right now — the audience itself currently matches nothing on Applivery's side.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {matchedDevices.length > 0 && (
                  <div className="max-h-40 overflow-y-auto divide-y" style={{ borderColor: theme.border }}>
                    {matchedDevices.map(d => (
                      <div key={d.id} className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="truncate" style={{ color: theme.text }}>{d.displayName || d.id}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px]" style={{ color: theme.textMuted }}>{d.platformLabel}</span>
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            title={d.isCompliant ? 'Compliant' : 'Not compliant'}
                            style={{ backgroundColor: d.isCompliant ? '#22C55E' : DANGER }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: theme.textMuted }}>
              Confirms the "Apply to devices" audience above actually resolves to real devices — the same membership
              resolution the evaluation itself uses, refreshed live each time you change the audience.
            </p>
          </div>
        </div>

        <div className="flex gap-3 justify-end px-5 py-4 shrink-0" style={{ borderTop: `1px solid ${theme.border}` }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            {isSaving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </div>
    </div>
  );
}
