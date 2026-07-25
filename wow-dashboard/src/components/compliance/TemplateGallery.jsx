import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { CloseCircle as X, ShieldCheck, DangerTriangle as AlertTriangle } from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const SEVERITY_COLORS = { low: '#64748B', medium: '#F59E0B', high: '#EF4444', critical: '#B91C1C' };

// Turns a curated template (from GET /api/compliance/templates) into the
// same shape PolicyBuilder's `policy` prop already accepts for editing —
// deliberately id-less, so the builder's existing save logic (POST when
// there's no policy.id) creates a brand-new policy rather than trying to
// PUT over something that doesn't exist yet. This is why no new save path
// was needed on the backend: the template is just a pre-filled draft the
// analyst reviews and edits like any other new policy before hitting Save.
export function templateToPolicyDraft(template, frameworkLabel) {
  return {
    name: template.title,
    description: `${template.description}\n\nFramework: ${frameworkLabel} — ${template.controlRef}. Generated from a template — review conditions and thresholds before enabling autoRun.`,
    severity: template.severity,
    conditionLogic: template.conditionLogic,
    conditions: template.conditions,
    autoRun: false,
    openCaseOnViolation: true,
    // Kept on save (see PolicyBuilder's framework/controlRef pass-through)
    // so this policy stays traceable to the control it came from — that's
    // what lets the framework-scoped report widgets (Settings > Reporting)
    // roll live policies up by ISO27001/ENS/NIS2 control instead of only
    // showing "N policies exist" with no idea which controls they cover.
    framework: template.framework,
    controlRef: template.controlRef,
  };
}

export default function TemplateGallery({ apiToken, orgSlug, theme, onClose, onUseTemplate }) {
  const [frameworks, setFrameworks] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeFramework, setActiveFramework] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await axios.get('/api/compliance/templates', { headers });
        setFrameworks(res.data?.frameworks || []);
        setTemplates(res.data?.items || []);
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load compliance templates.');
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameworksByKey = useMemo(() => Object.fromEntries(frameworks.map(f => [f.key, f])), [frameworks]);
  const visibleTemplates = activeFramework === 'all' ? templates : templates.filter(t => t.framework === activeFramework);

  return (
    <div className="fixed inset-0 z-[270] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: theme.card, maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: theme.text }}>Compliance Policy Templates</h3>
            <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>Starting points mapped to well-known frameworks. Pick one to pre-fill the policy builder for review.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 shrink-0" style={{ color: theme.textMuted }}><X size={16} /></button>
        </div>

        {/* Framework filter chips */}
        <div className="flex items-center gap-2 px-5 py-3 overflow-x-auto shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <button
            onClick={() => setActiveFramework('all')}
            className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
            style={activeFramework === 'all'
              ? { backgroundColor: PRIMARY_BLUE, color: '#fff' }
              : { border: `1px solid ${theme.border}`, color: theme.text }}
          >
            All frameworks
          </button>
          {frameworks.map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFramework(f.key)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
              style={activeFramework === f.key
                ? { backgroundColor: PRIMARY_BLUE, color: '#fff' }
                : { border: `1px solid ${theme.border}`, color: theme.text }}
            >
              {f.shortLabel}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium flex items-start gap-2" style={{ backgroundColor: '#EF444412', color: '#EF4444', border: '1px solid #EF444430' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {isLoading && <p className="text-xs" style={{ color: theme.textMuted }}>Loading templates…</p>}

          {!isLoading && activeFramework !== 'all' && frameworksByKey[activeFramework]?.caveats && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: `${PRIMARY_BLUE}08`, border: `1px solid ${PRIMARY_BLUE}25`, color: theme.text }}>
              <strong>Scope note:</strong> {frameworksByKey[activeFramework].caveats}
            </div>
          )}

          <div className="space-y-3">
            {visibleTemplates.map(t => {
              const fw = frameworksByKey[t.framework];
              const sevColor = SEVERITY_COLORS[t.severity] || SEVERITY_COLORS.medium;
              return (
                <div key={t.id} className="p-4 rounded-xl" style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                          {fw?.shortLabel || t.framework}
                        </span>
                        <span className="text-[10px] font-medium" style={{ color: theme.textMuted }}>{t.controlRef}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase" style={{ backgroundColor: `${sevColor}15`, color: sevColor }}>
                          {t.severity}
                        </span>
                      </div>
                      <p className="text-sm font-medium mt-1.5" style={{ color: theme.text }}>{t.title}</p>
                      <p className="text-xs mt-1" style={{ color: theme.textMuted }}>{t.description}</p>
                    </div>
                    <button
                      onClick={() => onUseTemplate(t, fw?.label || t.framework)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
                    >
                      <ShieldCheck size={13} /> Use template
                    </button>
                  </div>
                </div>
              );
            })}
            {!isLoading && !error && visibleTemplates.length === 0 && (
              <p className="text-xs text-center py-8" style={{ color: theme.textMuted }}>No templates for this framework yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
