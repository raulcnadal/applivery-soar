import React, { useState } from 'react';
import axios from 'axios';
import { CloseCircle as X, Buildings2 as Building2, Copy, MagicStick as Wand2, CheckCircle as CheckCircle2, DangerTriangle as AlertTriangle } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';

// Mirrors EXPORTABLE_CONFIG_STORES in main.py. Kept local to this component
// rather than shared with the Backup & Restore section's own copy in
// App.jsx (CONFIG_STORE_LABELS) — same "small duplicated constant, no
// cross-file import" precedent as FRAMEWORK_SHORT_LABELS in
// PolicyBuilder.jsx, since this app's components don't import from App.jsx.
const CONFIG_STORE_LABELS = {
  compliancePolicies: 'Compliance Policies', workflows: 'Workflows', triggers: 'Inbound Webhook Triggers',
  integrations: 'Ticketing / Chat / Paging Integrations', caseAutoRunRules: 'Case Auto-Run Rules',
  caseSlaSettings: 'Case SLA thresholds', threatIntelProviders: 'Threat Intel providers',
  appliveryWebhookConfig: 'Applivery inbound webhook config', actionLibrary: 'Action Library',
  appLists: 'App Lists', scriptRepos: 'Script Library', dashboardState: 'Dashboard settings (SMTP, webhook, retention…)',
};

// Stores an admin almost always wants copied onto a new workspace — org
// standards with no per-workspace secret embedded in them. Everything else
// (integrations, threat intel providers, the Applivery webhook config)
// typically carries a workspace-specific secret or endpoint — a Slack
// channel, a PagerDuty routing key, a webhook shared secret — that would
// silently misroute alerts into the wrong workspace if cloned by default.
// Pre-ticked, never auto-submitted; the admin still reviews and confirms.
const DEFAULT_CHECKED_STORES = new Set([
  'compliancePolicies', 'workflows', 'triggers', 'caseAutoRunRules', 'caseSlaSettings',
  'actionLibrary', 'appLists', 'scriptRepos', 'dashboardState',
]);

export default function WorkspaceOnboardingModal({ apiToken, orgSlug, organizations, theme, canCopyConfig = true, onClose, onCloned }) {
  const [mode, setMode] = useState('choice'); // 'choice' | 'copy'
  const [sourceSlug, setSourceSlug] = useState('');
  const [selected, setSelected] = useState(() => Object.fromEntries(Object.keys(CONFIG_STORE_LABELS).map(k => [k, DEFAULT_CHECKED_STORES.has(k)])));
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };
  const siblings = canCopyConfig ? (organizations || []).filter(o => o.slug !== orgSlug) : [];

  function dismissForThisWorkspace() {
    try { localStorage.setItem(`applivery_onboarding_dismissed_${orgSlug}`, '1'); } catch (e) { /* ignore */ }
  }

  function handleStartFromScratch() {
    dismissForThisWorkspace();
    onClose();
  }

  async function handleClone() {
    const stores = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (!sourceSlug) { setError('Pick a workspace to copy from.'); return; }
    if (stores.length === 0) { setError('Select at least one item to copy.'); return; }
    setIsCloning(true);
    setError(null);
    try {
      await axios.post('/api/config/clone-from', { sourceWorkspaceSlug: sourceSlug, stores }, { headers });
      dismissForThisWorkspace();
      onCloned ? onCloned() : onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to copy configuration.');
    } finally {
      setIsCloning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[280] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: theme.card, maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-2 min-w-0">
            <Building2 size={16} style={{ color: PRIMARY_BLUE }} />
            <h3 className="text-sm font-semibold" style={{ color: theme.text }}>Set up this workspace</h3>
          </div>
          <button onClick={handleStartFromScratch} className="p-1 rounded-lg hover:opacity-70 shrink-0" style={{ color: theme.textMuted }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          <p className="text-xs mb-4" style={{ color: theme.textMuted }}>
            This workspace doesn't have any Compliance Policies, Workflows, or other configuration yet.
            {siblings.length > 0 ? ' You have access to other workspaces in this account — want to start from one of them instead of from scratch?' : ''}
          </p>

          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium flex items-start gap-2" style={{ backgroundColor: `${DANGER}12`, color: DANGER, border: `1px solid ${DANGER}30` }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {mode === 'choice' && (
            <div className="space-y-2">
              {siblings.length > 0 && (
                <button
                  onClick={() => setMode('copy')}
                  className="w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all hover:border-blue-500"
                  style={{ borderColor: theme.border }}
                >
                  <Copy size={18} style={{ color: PRIMARY_BLUE }} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: theme.text }}>Copy configuration from another workspace</p>
                    <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>Bring over Compliance Policies, Workflows, and other settings from a workspace you already have set up.</p>
                  </div>
                </button>
              )}
              <button
                onClick={handleStartFromScratch}
                className="w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all hover:border-blue-500"
                style={{ borderColor: theme.border }}
              >
                <Wand2 size={18} style={{ color: theme.textMuted }} className="shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold" style={{ color: theme.text }}>Start from scratch</p>
                  <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>Configure this workspace's policies and workflows yourself. You can still copy from another workspace later from Settings &gt; Backup &amp; Restore.</p>
                </div>
              </button>
            </div>
          )}

          {mode === 'copy' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: theme.text }}>Copy from</label>
                <select
                  value={sourceSlug}
                  onChange={(e) => setSourceSlug(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 transition-all"
                  style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                >
                  <option value="">Select a workspace…</option>
                  {siblings.map(org => <option key={org.id} value={org.slug}>{org.name} ({org.slug})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: theme.text }}>What to copy</label>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {Object.entries(CONFIG_STORE_LABELS).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: theme.text }}>
                      <input
                        type="checkbox"
                        checked={!!selected[key]}
                        onChange={(e) => setSelected(s => ({ ...s, [key]: e.target.checked }))}
                      />
                      {label}
                      {!DEFAULT_CHECKED_STORES.has(key) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${DANGER}12`, color: DANGER }}>contains secrets</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setMode('choice')}
                  className="px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                >
                  Back
                </button>
                <button
                  onClick={handleClone}
                  disabled={isCloning}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 size={14} /> {isCloning ? 'Copying…' : 'Copy configuration'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
