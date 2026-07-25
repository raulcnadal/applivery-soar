import React from 'react';

// Shared sub-view switcher — one canonical look for every place in the app
// that lets you flip between peer sub-views of the same page (Reporting's
// Builder/Schedules/Template, Workflows' Workflows/Script & OMA-URI Library,
// Compliance's Policies/App Lists). Previously each of these had its own
// bespoke markup with different active-state styling and different
// placement relative to the page header; this centralizes both.
export default function ViewSwitcher({ theme, tabs, active, onChange, className = '' }) {
  return (
    <div
      className={`flex items-center gap-1 p-1 rounded-xl border shrink-0 ${className}`}
      style={{ backgroundColor: theme.bg, borderColor: theme.border }}
    >
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          style={{
            // BlueSky's segmented/pill tabs spec colors the active tab's text
            // gray-900 (theme.text), not the brand color — brand-600 is
            // reserved for the underline-tabs variant's active state.
            backgroundColor: active === id ? theme.card : 'transparent',
            color: active === id ? theme.text : theme.textMuted,
            boxShadow: active === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          {Icon && <Icon size={14} />}
          {label}
        </button>
      ))}
    </div>
  );
}
