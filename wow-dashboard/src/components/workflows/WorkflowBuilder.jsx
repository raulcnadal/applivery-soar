import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { CloseCircle as X, AddSquare as Plus, TrashBinMinimalistic as Trash2, AltArrowUp as ChevronUp, AltArrowDown as ChevronDown, AltArrowLeft as ChevronLeft, Smartphone, Global as Globe, Bell, DangerTriangle as AlertTriangle, InfoCircle as Info, ShieldWarning as ShieldAlert, AddSquare as ListPlus, RestartCircle as RotateCcw, Eye, ClockCircle as Clock, ShieldCheck, CheckCircle as CheckCircle2, CodeFile as FileCode2 } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

function newStepId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Internal platform keys match the backend's normalized device.platform values —
// 'apple' means iOS specifically (macOS is tracked separately), matching what
// the Devices view already stores per device.
const PLATFORM_OPTIONS = [
  { value: 'apple', label: 'iOS' },
  { value: 'macos', label: 'macOS' },
  { value: 'android', label: 'Android' },
  { value: 'windows', label: 'Windows' },
  { value: 'aosp', label: 'AOSP' },
];
const PLATFORM_LABELS = Object.fromEntries(PLATFORM_OPTIONS.map(p => [p.value, p.label]));

// Only 'mdm_action' is gated behind selecting a target platform (Step 1) —
// everything else, including the policy/monitor/wait steps, is agnostic and
// always available, same as HTTP Request/Notification.
const STEP_TYPES = [
  { key: 'mdm_action', label: 'MDM Action', Icon: Smartphone },
  { key: 'run_script_wait', label: 'Run Script & Wait for Result', Icon: FileCode2 },
  { key: 'http_request', label: 'HTTP Request', Icon: Globe },
  { key: 'notification', label: 'Notification', Icon: Bell },
  { key: 'policy_replace', label: 'Quarantine (Replace Policies)', Icon: ShieldAlert },
  { key: 'policy_add', label: 'Add Policy', Icon: ListPlus },
  { key: 'policy_restore', label: 'Restore Policies', Icon: RotateCcw },
  { key: 'monitor', label: 'Monitor Compliance', Icon: Eye },
  { key: 'wait', label: 'Wait', Icon: Clock },
];

function emptyStepConfig(type) {
  if (type === 'mdm_action') return { action: '' };
  if (type === 'run_script_wait') return { libraryId: '', timeoutMinutes: 30 };
  if (type === 'http_request') return { method: 'POST', url: '', headers: {}, body: '' };
  if (type === 'notification') return { channel: 'webhook', target: 'admin', webhookUrl: '', recipients: '', subject: '', title: '', message: '' };
  if (type === 'policy_replace') return { policyId: '', policyName: '' };
  if (type === 'policy_add') return { policyId: '', policyName: '', priority: 'bottom' };
  if (type === 'policy_restore') return {};
  if (type === 'monitor') return { compliancePolicyId: '', restoreOnCompliant: true };
  if (type === 'wait') return { amount: 30, unit: 'minutes' };
  return {};
}

function isActionCompatible(action, targetPlatform, targetDeploymentModel) {
  if (!targetPlatform) return false;
  if (!(action.platforms || []).includes(targetPlatform)) return false;
  const allowedModels = (action.deploymentModels || {})[targetPlatform];
  if (allowedModels && allowedModels.length) {
    // The action is gated to specific deployment models on this platform —
    // require one to actually be chosen and matching. Previously an
    // unselected targetDeploymentModel ('') short-circuited this check,
    // which let e.g. supervised-only iOS actions show as "compatible" for a
    // workflow that hadn't committed to supervised/unsupervised yet.
    if (!targetDeploymentModel || !allowedModels.includes(targetDeploymentModel)) return false;
  }
  return true;
}

function BranchSelect({ label, value, onChange, steps, currentStepId, theme, isFailure }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
        style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
      >
        <option value="">{isFailure ? 'Stop (default)' : 'Next step (default)'}</option>
        <option value="end">End workflow</option>
        {steps.filter(s => s.id !== currentStepId).map(s => (
          <option key={s.id} value={s.id}>Jump to: {s.name || 'Untitled step'}</option>
        ))}
      </select>
    </div>
  );
}

function StepEditor({ step, index, steps, mdmActions, policies, apps, scriptLibrary, omaUriLibrary, firewallLibrary, compliancePolicies, targetPlatform, targetDeploymentModel, availableStepTypes, theme, onChange, onRemove, onMove, showBranching = true }) {
  const config = step.config || {};
  const meta = MDM_ACTIONS_META(mdmActions, config.action);
  const compatible = mdmActions.filter(a => isActionCompatible(a, targetPlatform, targetDeploymentModel));
  const currentIncompatible = config.action && !compatible.some(a => a.key === config.action)
    ? mdmActions.find(a => a.key === config.action)
    : null;

  function setConfig(patch) {
    onChange({ ...step, config: { ...config, ...patch } });
  }

  return (
    <div className="rounded-xl p-4 mb-3" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold shrink-0" style={{ color: theme.textMuted }}>Step {index + 1}</span>
        <input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          placeholder="Step name…"
          className="flex-1 px-2 py-1 rounded-md text-sm font-medium outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
        />
        <select
          value={step.type}
          onChange={(e) => onChange({ ...step, type: e.target.value, config: emptyStepConfig(e.target.value) })}
          className="px-2 py-1 rounded-md text-xs outline-none shrink-0 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
        >
          {availableStepTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 rounded disabled:opacity-30" style={{ color: theme.textMuted }}><ChevronUp size={14} /></button>
        <button onClick={() => onMove(1)} disabled={index === steps.length - 1} className="p-1 rounded disabled:opacity-30" style={{ color: theme.textMuted }}><ChevronDown size={14} /></button>
        <button onClick={onRemove} className="p-1 rounded" style={{ color: DANGER }}><Trash2 size={14} /></button>
      </div>

      {step.type === 'mdm_action' && (
        <div>
          <select
            value={config.action || ''}
            onChange={(e) => setConfig({ action: e.target.value, params: {} })}
            className="w-full px-2 py-1.5 rounded-lg text-sm outline-none mb-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">Select an action…</option>
            {currentIncompatible && (
              <option value={currentIncompatible.key}>{currentIncompatible.label} (incompatible with target — will fail)</option>
            )}
            {compatible.map(a => <option key={a.key} value={a.key}>{a.label}{a.destructive ? ' ⚠' : ''}{a.unconfirmed ? ' (not wired yet)' : ''}</option>)}
          </select>
          {compatible.length === 0 && !currentIncompatible && (
            <p className="text-xs mb-2" style={{ color: theme.textMuted }}>
              No MDM actions match the workflow's target platform/deployment model yet.
            </p>
          )}
          {meta?.destructive && (
            <p className="inline-flex items-center gap-1.5 text-xs mb-2" style={{ color: WARNING }}>
              <AlertTriangle size={12} /> Destructive — cannot be undone on the device.
            </p>
          )}
          {meta?.unconfirmed && (
            <p className="inline-flex items-start gap-1.5 text-xs mb-2" style={{ color: WARNING }}>
              <Info size={12} className="shrink-0 mt-0.5" /> Shown for planning, but not yet wired to a verified Applivery API call — running it will fail with an explanatory error. Use the Applivery Dashboard directly for now.
            </p>
          )}
          {config.action === 'runScript' && (
            <p className="inline-flex items-start gap-1.5 text-xs mb-2" style={{ color: theme.textMuted }}>
              <Info size={12} className="shrink-0 mt-0.5" /> Add script Policies to pick from under Workflows → Script & OMA-URI Library.
            </p>
          )}
          {(config.action === 'applyFirewallRuleSet' || config.action === 'restoreFirewallRuleSet') && (
            <p className="inline-flex items-start gap-1.5 text-xs mb-2" style={{ color: theme.textMuted }}>
              <Info size={12} className="shrink-0 mt-0.5" /> Build rule sets to pick from under Workflows → Firewall Policy Library. Restore only removes this rule set's own tagged rules — the device's prior firewall state returns automatically.
            </p>
          )}
          {config.action === 'customOmaUri' && (omaUriLibrary || []).length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const entry = (omaUriLibrary || []).find(o => o.id === e.target.value);
                if (entry) setConfig({ params: { ...(config.params || {}), path: entry.path, action: entry.action, format: entry.format, value: entry.value } });
              }}
              className="w-full px-2 py-1.5 rounded-lg text-xs outline-none mb-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              <option value="">Load from OMA-URI Library…</option>
              {omaUriLibrary.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {(meta?.fields || []).length > 0 && (
            <div className="space-y-2 p-3 rounded-lg mb-2" style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
              {meta.fields.map(field => (
                <div key={field.key}>
                  <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>
                    {field.label}{field.required ? ' *' : ''}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      value={(config.params || {})[field.key] || ''}
                      onChange={(e) => setConfig({ params: { ...(config.params || {}), [field.key]: e.target.value } })}
                      className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                    >
                      <option value="">Select…</option>
                      {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.type === 'app_select' ? (
                    <select
                      value={(config.params || {})[field.key] || ''}
                      onChange={(e) => setConfig({ params: { ...(config.params || {}), [field.key]: e.target.value } })}
                      className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                    >
                      <option value="">{(apps || []).length ? 'Select an app…' : 'No apps found in App Distribution'}</option>
                      {(apps || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  ) : field.type === 'script_library_select' ? (
                    (() => {
                      const matching = (scriptLibrary || []).filter(s => s.platform === targetPlatform);
                      return (
                        <select
                          value={(config.params || {})[field.key] || ''}
                          onChange={(e) => setConfig({ params: { ...(config.params || {}), [field.key]: e.target.value } })}
                          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                          style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                        >
                          <option value="">{matching.length ? 'Select…' : `No ${PLATFORM_LABELS[targetPlatform] || targetPlatform} scripts in the Library yet`}</option>
                          {matching.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      );
                    })()
                  ) : field.type === 'firewall_ruleset_select' ? (
                    <select
                      value={(config.params || {})[field.key] || ''}
                      onChange={(e) => setConfig({ params: { ...(config.params || {}), [field.key]: e.target.value } })}
                      className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                    >
                      <option value="">{(firewallLibrary || []).length ? 'Select…' : 'No Firewall Rule Sets in the Library yet'}</option>
                      {(firewallLibrary || []).map(rs => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                    </select>
                  ) : (
                    <>
                      <input
                        type={field.type === 'password' ? 'password' : 'text'}
                        value={(config.params || {})[field.key] || ''}
                        onChange={(e) => setConfig({ params: { ...(config.params || {}), [field.key]: e.target.value } })}
                        placeholder={field.placeholder || ''}
                        className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                        style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                      />
                      {config.action === 'scheduleOsUpdate' && field.key === 'productVersion' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setConfig({ params: { ...(config.params || {}), productVersion: '{{ device.osLifecycleStatus.latestKnownVersion }}' } })}
                            className="mt-1 text-[10px] font-semibold px-2 py-1 rounded-lg"
                            style={{ border: `1px solid ${theme.border}`, color: theme.textMuted }}
                          >
                            Use latest known version (auto, per device)
                          </button>
                          <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>
                            A hardcoded version applies the same target to every device. Use the template above to
                            resolve each device's own target at run time from the OS Lifecycle catalog (Apple's GDMF
                            data where available) instead of editing this workflow every time a new version ships —
                            this only closes the loop for policies that already read osEol/appleAppUpdatesPending
                            etc. as a trigger condition.
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step.type === 'run_script_wait' && (
        <div className="space-y-2">
          {(() => {
            const matching = (scriptLibrary || []).filter(s => s.platform === targetPlatform);
            return (
              <select
                value={config.libraryId || ''}
                onChange={(e) => setConfig({ libraryId: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              >
                <option value="">{matching.length ? 'Select a script…' : `No ${PLATFORM_LABELS[targetPlatform] || targetPlatform} scripts in the Library yet`}</option>
                {matching.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            );
          })()}
          <div className="flex items-center gap-2">
            <label className="text-xs shrink-0" style={{ color: theme.textMuted }}>Timeout</label>
            <input
              type="number"
              min="1"
              value={config.timeoutMinutes ?? 30}
              onChange={(e) => setConfig({ timeoutMinutes: e.target.value })}
              className="w-20 px-2 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
            <span className="text-xs" style={{ color: theme.textMuted }}>minutes</span>
          </div>
          <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: theme.textMuted }}>
            <Info size={12} className="shrink-0 mt-0.5" /> Dispatches the script, then pauses this device's chain until the Applivery agent actually reports back a result (not just that the command was accepted). "On success" fires if the script exits clean; "On failure" fires if it errors, the timeout above elapses first, or no result ever comes back (e.g. device offline).
          </p>
        </div>
      )}

      {step.type === 'http_request' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={config.method || 'POST'}
              onChange={(e) => setConfig({ method: e.target.value })}
              className="px-2 py-1.5 rounded-lg text-xs outline-none shrink-0 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
            </select>
            <input
              value={config.url || ''}
              onChange={(e) => setConfig({ url: e.target.value })}
              placeholder="https://api.example.com/webhook — supports {{ device.displayName }} templating"
              className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
          </div>
          <textarea
            value={typeof config.headers === 'string' ? config.headers : JSON.stringify(config.headers || {}, null, 2)}
            onChange={(e) => {
              try { setConfig({ headers: JSON.parse(e.target.value) }); }
              catch { setConfig({ headers: e.target.value }); }
            }}
            placeholder='Headers (JSON), e.g. {"Authorization": "Bearer ..."}'
            rows={2}
            className="w-full px-2 py-1.5 rounded-lg text-xs font-mono outline-none resize-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
          <textarea
            value={config.body || ''}
            onChange={(e) => setConfig({ body: e.target.value })}
            placeholder='Body (JSON or text), e.g. {"device": "{{ device.displayName }}", "reason": "non-compliant"}'
            rows={3}
            className="w-full px-2 py-1.5 rounded-lg text-xs font-mono outline-none resize-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
        </div>
      )}

      {step.type === 'notification' && (
        <div className="space-y-2">
          <select
            value={config.channel || 'webhook'}
            onChange={(e) => setConfig({ channel: e.target.value })}
            className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="webhook">Google Chat webhook</option>
            <option value="email">Email</option>
            <option value="applivery_push">Applivery push (requires Agent)</option>
          </select>

          {config.channel === 'webhook' && (
            <input
              value={config.webhookUrl || ''}
              onChange={(e) => setConfig({ webhookUrl: e.target.value })}
              placeholder="Webhook URL (leave blank to use the one configured in Settings)"
              className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
          )}

          {config.channel === 'email' && (
            <>
              <select
                value={config.target || 'admin'}
                onChange={(e) => setConfig({ target: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              >
                <option value="admin">Admin only</option>
                <option value="user">Device's assigned user only</option>
                <option value="admin_and_user">Admin + device's assigned user</option>
              </select>
              {(config.target === 'admin' || config.target === 'admin_and_user') && (
                <input
                  value={config.recipients || ''}
                  onChange={(e) => setConfig({ recipients: e.target.value })}
                  placeholder="Admin recipients (comma-separated)"
                  className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                  style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
                />
              )}
              {(config.target === 'user' || config.target === 'admin_and_user') && (
                <p className="text-xs" style={{ color: theme.textMuted }}>
                  Sent to the device's assigned MDM user email — devices with no assigned user will fail this step.
                </p>
              )}
              <input
                value={config.subject || ''}
                onChange={(e) => setConfig({ subject: e.target.value })}
                placeholder="Subject"
                className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              />
            </>
          )}

          {config.channel === 'applivery_push' && (
            <>
              <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: WARNING }}>
                <Info size={12} className="shrink-0 mt-0.5" /> Requires the Applivery Agent (mdmAgent) installed and registered on the device — sent directly to that device, not to an admin inbox.
              </p>
              <input
                value={config.title || ''}
                onChange={(e) => setConfig({ title: e.target.value })}
                placeholder="Notification title"
                className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
              />
            </>
          )}

          <textarea
            value={config.message || ''}
            onChange={(e) => setConfig({ message: e.target.value })}
            placeholder="Message — supports {{ device.displayName }} templating"
            rows={2}
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none resize-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          />
        </div>
      )}

      {step.type === 'policy_replace' && (
        <div className="space-y-2">
          <select
            value={config.policyId || ''}
            onChange={(e) => {
              const opt = policies.find(p => p.id === e.target.value);
              setConfig({ policyId: e.target.value, policyName: opt?.name || '' });
            }}
            className="w-full px-2 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">Select replacement policy…</option>
            {policies.map(p => (
              <option key={`${p.platform}-${p.id}`} value={p.id}>
                {targetPlatform ? p.name : `[${PLATFORM_LABELS[p.platform] || p.platform}] ${p.name}`}
              </option>
            ))}
          </select>
          <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: WARNING }}>
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            Quarantine — replaces ALL of the device's current policies with this one. The original stack is snapshotted automatically and can be brought back later with a Restore Policies step, or a Monitor step with "Restore when compliant" checked.
          </p>
        </div>
      )}

      {step.type === 'policy_add' && (
        <div className="space-y-2">
          <select
            value={config.policyId || ''}
            onChange={(e) => {
              const opt = policies.find(p => p.id === e.target.value);
              setConfig({ policyId: e.target.value, policyName: opt?.name || '' });
            }}
            className="w-full px-2 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">Select policy to add…</option>
            {policies.map(p => (
              <option key={`${p.platform}-${p.id}`} value={p.id}>
                {targetPlatform ? p.name : `[${PLATFORM_LABELS[p.platform] || p.platform}] ${p.name}`}
              </option>
            ))}
          </select>
          <select
            value={config.priority || 'bottom'}
            onChange={(e) => setConfig({ priority: e.target.value })}
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="top">Primary (top priority)</option>
            <option value="bottom">Lowest priority (fallback)</option>
          </select>
          <p className="text-xs" style={{ color: theme.textMuted }}>
            Adds alongside existing policies — doesn't replace them. The pre-change stack is snapshotted the same way, in case this needs undoing later.
          </p>
        </div>
      )}

      {step.type === 'policy_restore' && (
        <p className="text-xs" style={{ color: theme.textMuted }}>
          Restores whatever policy stack was snapshotted the first time a Quarantine or Add Policy step touched this device, then clears the snapshot. Fails gracefully (no-op) if nothing is currently quarantined.
        </p>
      )}

      {step.type === 'monitor' && (
        <div className="space-y-2">
          <select
            value={config.compliancePolicyId || ''}
            onChange={(e) => setConfig({ compliancePolicyId: e.target.value })}
            className="w-full px-2 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
          >
            <option value="">Select compliance policy to re-check…</option>
            {compliancePolicies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
            <input
              type="checkbox"
              checked={config.restoreOnCompliant !== false}
              onChange={(e) => setConfig({ restoreOnCompliant: e.target.checked })}
            />
            Restore previous policies automatically when compliant again
          </label>
          <p className="text-xs" style={{ color: theme.textMuted }}>
            "On success" below fires when the device is compliant again (default: stop — the loop is over). "On failure" fires when it's still violating — leave it as "Next step (default)" to escalate to the next tier, or jump back to an earlier Wait step to keep looping.
          </p>
        </div>
      )}

      {step.type === 'wait' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              value={config.amount ?? 30}
              onChange={(e) => setConfig({ amount: e.target.value })}
              className="w-24 px-2 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            />
            <select
              value={config.unit || 'minutes'}
              onChange={(e) => setConfig({ unit: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.text }}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
          <p className="text-xs" style={{ color: theme.textMuted }}>
            Pauses this device's chain before continuing — pairs with Monitor to build a multi-tier escalation (act, wait, monitor, escalate). Long waits only survive as long as the dashboard's backend process does.
          </p>
        </div>
      )}

      {showBranching && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <BranchSelect label="On success" value={step.onSuccess} onChange={(v) => onChange({ ...step, onSuccess: v })} steps={steps} currentStepId={step.id} theme={theme} />
          <BranchSelect label="On failure" value={step.onFailure} onChange={(v) => onChange({ ...step, onFailure: v })} steps={steps} currentStepId={step.id} theme={theme} isFailure />
        </div>
      )}
    </div>
  );
}

function MDM_ACTIONS_META(list, key) {
  return list.find(a => a.key === key);
}

export default function WorkflowBuilder({ workflow, apiToken, orgSlug, theme, onClose, onSaved }) {
  // Wizard: 'details' (name/description/platform/deployment model — locked
  // once you move past it) then 'steps' (steps + Recovery, both filtered to
  // whatever was locked in on 'details'). Editing an existing workflow opens
  // straight to 'steps' since its target is already set; "Back" still
  // reaches 'details' to change it. This structurally replaces the old
  // single-screen layout where the platform/deployment pickers stayed
  // visible and editable the whole time, which is what let admins add step 1
  // under iOS Supervised and then quietly switch to iOS Unsupervised (or a
  // different platform entirely) before adding step 2.
  const [screen, setScreen] = useState(workflow ? 'steps' : 'details');
  const [name, setName] = useState(workflow?.name || '');
  const [description, setDescription] = useState(workflow?.description || '');
  const [steps, setSteps] = useState(workflow?.steps || []);
  const [targetPlatform, setTargetPlatform] = useState(workflow?.targetPlatform || '');
  const [targetDeploymentModel, setTargetDeploymentModel] = useState(workflow?.targetDeploymentModel || '');
  const [recovery, setRecovery] = useState({
    enabled: workflow?.recovery?.enabled || false,
    compliancePolicyId: workflow?.recovery?.compliancePolicyId || '',
    steps: workflow?.recovery?.steps || [],
  });
  // Author-level default for whether this workflow is meant to be safe to
  // fire unattended even though it contains a destructive step — see the
  // WorkflowPayload.allowUnattendedDestructive comment on the backend.
  // Does NOT bypass the separate, still-required acknowledgment on
  // whichever Compliance Policy/Case Auto-Run Rule/Applivery Event rule
  // ends up referencing this workflow; it only sets that checkbox's
  // starting value when one of those is first pointed at this workflow.
  const [allowUnattendedDestructive, setAllowUnattendedDestructive] = useState(workflow?.allowUnattendedDestructive || false);
  const [mdmActions, setMdmActions] = useState([]);
  const [deploymentModels, setDeploymentModels] = useState({});
  const [policies, setPolicies] = useState([]);
  const [apps, setApps] = useState([]);
  const [compliancePolicies, setCompliancePolicies] = useState([]);
  const [actionLibrary, setActionLibrary] = useState([]);
  const [firewallLibrary, setFirewallLibrary] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };
  const modelOptions = deploymentModels[targetPlatform] || [];
  const needsDeploymentModel = ['apple', 'macos', 'android'].includes(targetPlatform);
  const availableStepTypes = targetPlatform ? STEP_TYPES : STEP_TYPES.filter(t => t.key !== 'mdm_action' && t.key !== 'run_script_wait');
  const scriptLibrary = actionLibrary.filter(e => e.type === 'script');
  const omaUriLibrary = actionLibrary.filter(e => e.type === 'oma_uri');
  // Mirrors _workflow_has_destructive_step on the backend and the same
  // client-side check PolicyBuilder.jsx does — evaluated against this
  // draft's own current step list (not a saved workflow object), so the
  // panel below appears/disappears live as steps are added or removed.
  const mdmActionsByKey = useMemo(() => Object.fromEntries(mdmActions.map(a => [a.key, a])), [mdmActions]);
  const hasDestructiveStep = steps.some(s => s.type === 'mdm_action' && mdmActionsByKey[s.config?.action]?.destructive);

  useEffect(() => {
    axios.get('/api/mdm-actions', { headers }).then(res => setMdmActions(res.data?.items || [])).catch(() => {});
    axios.get('/api/deployment-models', { headers }).then(res => setDeploymentModels(res.data?.items || {})).catch(() => {});
    axios.get('/api/compliance/policies', { headers }).then(res => setCompliancePolicies(res.data?.items || [])).catch(() => {});
    axios.get('/api/action-library', { headers }).then(res => setActionLibrary(res.data?.items || [])).catch(() => {});
    axios.get('/api/firewall-rulesets', { headers }).then(res => setFirewallLibrary(res.data?.items || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Policies are platform-specific in Applivery. If a target platform is set,
  // fetch just that platform's list; otherwise (a platform-agnostic workflow)
  // fetch across all of them and tag each option so the admin can still pick
  // one — it's on them to only assign it to devices of the matching platform.
  useEffect(() => {
    let cancelled = false;
    const platformsToFetch = targetPlatform ? [targetPlatform] : PLATFORM_OPTIONS.map(p => p.value);
    Promise.all(platformsToFetch.map(pf =>
      axios.get('/api/policies', { headers, params: { platform: pf } })
        .then(res => (res.data?.items || []).map(p => ({ ...p, platform: pf })))
        .catch(() => [])
    )).then(results => { if (!cancelled) setPolicies(results.flat()); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPlatform]);

  // Apps back the Install/Uninstall app actions' picker — always platform-
  // specific (an mdm_action step only exists once a platform is chosen), so
  // unlike policies there's no "fetch across all platforms" fallback needed.
  useEffect(() => {
    let cancelled = false;
    if (!targetPlatform) { setApps([]); return undefined; }
    axios.get('/api/apps', { headers, params: { platform: targetPlatform } })
      .then(res => { if (!cancelled) setApps(res.data?.items || []); })
      .catch(() => { if (!cancelled) setApps([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPlatform]);

  // Keeps a workflow single-platform/single-deployment-model: whenever the
  // target changes, any existing mdm_action step whose chosen action is no
  // longer compatible gets its action cleared (must be explicitly re-picked
  // from the now-current, correctly-filtered list) rather than silently
  // continuing to reference an action from a different platform/deployment
  // model. Common steps (HTTP, notification, wait, monitor, policy steps)
  // are untouched — they're intentionally platform-agnostic.
  function reconcileStep(s, platform, deploymentModel) {
    if (s.type === 'mdm_action' && s.config?.action) {
      const meta = mdmActions.find(a => a.key === s.config.action);
      if (!(meta && isActionCompatible(meta, platform, deploymentModel))) return { ...s, config: emptyStepConfig('mdm_action') };
    }
    if (s.type === 'run_script_wait' && s.config?.libraryId) {
      const stillValid = scriptLibrary.some(entry => entry.id === s.config.libraryId && entry.platform === platform);
      if (!stillValid) return { ...s, config: emptyStepConfig('run_script_wait') };
    }
    return s;
  }

  function reconcileStepsForTarget(platform, deploymentModel) {
    setSteps(prevSteps => prevSteps.map(s => reconcileStep(s, platform, deploymentModel)));
    setRecovery(r => ({
      ...r,
      steps: r.steps.map(s => reconcileStep(s, platform, deploymentModel)),
    }));
  }

  function handlePlatformChange(value) {
    setTargetPlatform(value);
    setTargetDeploymentModel('');
    reconcileStepsForTarget(value, '');
  }

  function handleDeploymentModelChange(value) {
    setTargetDeploymentModel(value);
    reconcileStepsForTarget(targetPlatform, value);
  }

  function addStep() {
    const type = targetPlatform ? 'mdm_action' : 'http_request';
    setSteps([...steps, { id: newStepId(), type, name: '', config: emptyStepConfig(type), onSuccess: null, onFailure: null }]);
  }

  function updateStep(index, updated) {
    setSteps(steps.map((s, i) => (i === index ? updated : s)));
  }

  function removeStep(index) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  function moveStep(index, dir) {
    const next = [...steps];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
  }

  function addRecoveryStep() {
    const type = targetPlatform ? 'mdm_action' : 'http_request';
    setRecovery(r => ({ ...r, steps: [...r.steps, { id: newStepId(), type, name: '', config: emptyStepConfig(type), onSuccess: null, onFailure: null }] }));
  }

  function updateRecoveryStep(index, updated) {
    setRecovery(r => ({ ...r, steps: r.steps.map((s, i) => (i === index ? updated : s)) }));
  }

  function removeRecoveryStep(index) {
    setRecovery(r => ({ ...r, steps: r.steps.filter((_, i) => i !== index) }));
  }

  function moveRecoveryStep(index, dir) {
    setRecovery(r => {
      const next = [...r.steps];
      const target = index + dir;
      if (target < 0 || target >= next.length) return r;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...r, steps: next };
    });
  }

  function goToStepsScreen() {
    if (!name.trim()) { setError('Give this workflow a name.'); return; }
    if (!targetPlatform) {
      setError('Choose a target platform before continuing — MDM Action steps need one to know which commands are valid, and picking it here (rather than leaving it open) is what stops later steps from drifting to a different platform.');
      return;
    }
    if (needsDeploymentModel && !targetDeploymentModel) {
      setError(`Choose a deployment model for ${PLATFORM_LABELS[targetPlatform]} before continuing — every step on the next screen is locked to this exact platform + deployment model.`);
      return;
    }
    setError(null);
    setScreen('steps');
  }

  async function handleSave() {
    if (!name.trim()) { setError('Give this workflow a name.'); return; }
    // Belt-and-suspenders alongside reconcileStepsForTarget: block save if any
    // mdm_action step (escalation OR recovery) still references an action
    // that isn't compatible with this workflow's current target platform/
    // deployment model (e.g. a workflow loaded from before this check
    // existed, or a step edited in a way that slipped past the live filter).
    const isBadStep = (s) => {
      if (s.type !== 'mdm_action' || !s.config?.action) return false;
      const meta = mdmActions.find(a => a.key === s.config.action);
      return !meta || !isActionCompatible(meta, targetPlatform, targetDeploymentModel);
    };
    const badStep = steps.find(isBadStep) || recovery.steps.find(isBadStep);
    if (badStep) {
      setError(`Step "${badStep.name || 'Untitled step'}" uses an MDM action that doesn't match this workflow's target platform/deployment model (${PLATFORM_LABELS[targetPlatform] || 'none'}${targetDeploymentModel ? ' · ' + targetDeploymentModel : ''}). Fix or remove that step before saving.`);
      return;
    }
    if (recovery.enabled && !recovery.compliancePolicyId) {
      setError('Recovery is enabled but no Compliance Policy is selected to watch — pick one or disable Recovery.');
      return;
    }
    setIsSaving(true);
    setError(null);
    const body = { name, description, steps, targetPlatform: targetPlatform || null, targetDeploymentModel: targetDeploymentModel || null, recovery, allowUnattendedDestructive };
    try {
      const res = workflow?.id
        ? await axios.put(`/api/workflows/${workflow.id}`, body, { headers })
        : await axios.post('/api/workflows', body, { headers });
      onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save workflow.');
    } finally {
      setIsSaving(false);
    }
  }

  const modelLabel = modelOptions.find(m => m.value === targetDeploymentModel)?.label || targetDeploymentModel;

  return (
    <div className="fixed inset-0 z-[270] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: theme.card, maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: theme.text }}>{workflow ? 'Edit workflow' : 'Create workflow'}</h3>
            <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>
              {screen === 'details' ? 'Step 1 of 2 — Details' : 'Step 2 of 2 — Steps & Recovery'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70" style={{ color: theme.textMuted }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: `${DANGER}12`, color: DANGER, border: `1px solid ${DANGER}30` }}>
              {error}
            </div>
          )}

          {screen === 'details' ? (
            <>
              <div className="space-y-2 mb-5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Workflow name, e.g. Non-compliant device escalation"
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

              {/* ── Step 1: Platform, Step 2: Deployment model — locked in for the whole workflow once you continue ── */}
              <div className="rounded-xl p-4 mb-5" style={{ border: `1px solid ${theme.border}` }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>1. Target platform</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-1">
                  {PLATFORM_OPTIONS.map(p => (
                    <button
                      key={p.value}
                      onClick={() => handlePlatformChange(p.value)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={targetPlatform === p.value ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : { border: `1px solid ${theme.border}`, color: theme.text }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs mb-3" style={{ color: theme.textMuted }}>
                  {targetPlatform === 'aosp'
                    ? 'AOSP (rugged/kiosk Android without Google services) runs Device Owner only — no Work Profile/COPE sub-mode, so there’s no Step 2 here. '
                    : targetPlatform ? 'Once you continue, every MDM Action step (in both Steps and Recovery) is locked to this platform + deployment model — you can only come back here to change it. ' : 'Pick a platform to unlock MDM Action steps. '}
                  HTTP Request, Notification, Wait, Monitor Compliance, and the policy steps (Quarantine, Add, Restore) are common actions — always available on every platform, alongside that platform's MDM Actions, so you're never stuck picking between the two.
                </p>

                {needsDeploymentModel && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>2. Deployment model</p>
                    <div className="flex flex-wrap gap-2">
                      {modelOptions.map(m => (
                        <button
                          key={m.value}
                          onClick={() => handleDeploymentModelChange(m.value)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={targetDeploymentModel === m.value ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : { border: `1px solid ${theme.border}`, color: theme.text }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {!targetDeploymentModel && (
                      <p className="text-xs mt-2 inline-flex items-start gap-1.5" style={{ color: WARNING }}>
                        <Info size={12} className="shrink-0 mt-0.5" /> Required before continuing — this is what stops supervised-only and unsupervised-only actions from ending up mixed in the same workflow.
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Locked target summary — the only way to change it is "Back" */}
              <div className="flex items-center justify-between mb-5 px-3 py-2 rounded-lg" style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}>
                <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.text }}>
                  <CheckCircle2 size={14} style={{ color: PRIMARY_BLUE }} />
                  Target: {targetPlatform ? PLATFORM_LABELS[targetPlatform] : 'Common (no platform)'}{targetDeploymentModel && ` · ${modelLabel}`}
                </div>
                <button onClick={() => setScreen('details')} className="text-xs font-medium" style={{ color: PRIMARY_BLUE }}>Change</button>
              </div>

              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Steps</p>
                <button onClick={addStep} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: PRIMARY_BLUE }}>
                  <Plus size={12} /> Add step
                </button>
              </div>

              {steps.length === 0 && (
                <p className="text-xs text-center py-8" style={{ color: theme.textMuted }}>No steps yet — add one to get started.</p>
              )}

              {steps.map((step, i) => (
                <StepEditor
                  key={step.id}
                  step={step}
                  index={i}
                  steps={steps}
                  mdmActions={mdmActions}
                  policies={policies}
                  apps={apps}
                  scriptLibrary={scriptLibrary}
                  omaUriLibrary={omaUriLibrary}
                  firewallLibrary={firewallLibrary}
                  compliancePolicies={compliancePolicies}
                  targetPlatform={targetPlatform}
                  targetDeploymentModel={targetDeploymentModel}
                  availableStepTypes={availableStepTypes}
                  theme={theme}
                  onChange={(updated) => updateStep(i, updated)}
                  onRemove={() => removeStep(i)}
                  onMove={(dir) => moveStep(i, dir)}
                />
              ))}

              {hasDestructiveStep && (
                <div className="rounded-xl p-4 mt-6" style={{ border: `1px solid ${WARNING}40`, backgroundColor: `${WARNING}0A` }}>
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={15} style={{ color: WARNING }} className="shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold" style={{ color: theme.text }}>This workflow includes a destructive action</p>
                      <p className="text-[11px] mt-1 mb-2.5 leading-relaxed" style={{ color: theme.textMuted }}>
                        Anywhere this workflow is set to fire unattended — a Compliance Policy's autoRun, a Case Auto-Run Rule, or an Applivery Event rule — that specific policy/rule still requires its own explicit acknowledgment before it can actually run this workflow without human review. This toggle doesn't change that; it only sets the starting value of that acknowledgment checkbox the first time a policy/rule is pointed at this workflow.
                      </p>
                      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: theme.text }}>
                        <input type="checkbox" checked={allowUnattendedDestructive} onChange={(e) => setAllowUnattendedDestructive(e.target.checked)} />
                        This workflow is approved to run unattended (pre-fills new acknowledgment checkboxes as checked)
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Recovery: the one common place to define "device is no longer out of compliance" ── */}
              <div className="rounded-xl p-4 mt-6" style={{ border: `1px solid ${theme.border}` }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={15} style={{ color: PRIMARY_BLUE }} />
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Recovery — when compliance is restored</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium" style={{ color: theme.text }}>
                    <input type="checkbox" checked={recovery.enabled} onChange={(e) => setRecovery(r => ({ ...r, enabled: e.target.checked }))} />
                    Enabled
                  </label>
                </div>
                <p className="text-xs mb-3" style={{ color: theme.textMuted }}>
                  The moment the Compliance Policy below is no longer violated for a device, the Steps above stop escalating right there — no further steps run — and the recovery steps below run once, in order, to put the device back the way it was (e.g. Restore Policies, Install App to bring back something removed, Re-enable device). Any "Run script" step above with a restore script configured fires that restore script automatically first.
                </p>
                {recovery.enabled && (
                  <>
                    <select
                      value={recovery.compliancePolicyId || ''}
                      onChange={(e) => setRecovery(r => ({ ...r, compliancePolicyId: e.target.value }))}
                      className="w-full px-2 py-1.5 rounded-lg text-sm outline-none mb-3 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                    >
                      <option value="">Select compliance policy to watch…</option>
                      {compliancePolicies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>

                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Recovery steps</p>
                      <button onClick={addRecoveryStep} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: PRIMARY_BLUE }}>
                        <Plus size={12} /> Add recovery step
                      </button>
                    </div>

                    {recovery.steps.length === 0 && (
                      <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>No recovery steps yet — e.g. add a Restore Policies step.</p>
                    )}

                    {recovery.steps.map((step, i) => (
                      <StepEditor
                        key={step.id}
                        step={step}
                        index={i}
                        steps={recovery.steps}
                        mdmActions={mdmActions}
                        policies={policies}
                        apps={apps}
                        scriptLibrary={scriptLibrary}
                        omaUriLibrary={omaUriLibrary}
                        firewallLibrary={firewallLibrary}
                        compliancePolicies={compliancePolicies}
                        targetPlatform={targetPlatform}
                        targetDeploymentModel={targetDeploymentModel}
                        availableStepTypes={availableStepTypes}
                        theme={theme}
                        onChange={(updated) => updateRecoveryStep(i, updated)}
                        onRemove={() => removeRecoveryStep(i)}
                        onMove={(dir) => moveRecoveryStep(i, dir)}
                        showBranching={false}
                      />
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderTop: `1px solid ${theme.border}` }}>
          <div>
            {screen === 'steps' && (
              <button onClick={() => setScreen('details')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium" style={{ color: theme.textMuted }}>
                <ChevronLeft size={15} /> Back
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>Cancel</button>
            {screen === 'details' ? (
              <button
                onClick={goToStepsScreen}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                Next: Add steps →
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                {isSaving ? 'Saving…' : 'Save workflow'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
