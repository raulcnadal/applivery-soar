import React, { useState } from 'react';
import { InfoCircle as Info } from '@solar-icons/react';
import HelpModal from './HelpModal';

// Small ⓘ button that opens the matching admin guide (docs/*.md, served via
// GET /api/help/{slug}) in a modal. Self-contained — owns its own open/close
// state — so wiring it into a view/sub-view is a single line:
//   <HelpIcon slug="workflows" theme={theme} />
//   <HelpIcon slug="settings" anchor="vulnerability-service" theme={theme} title="Vulnerability Service help" />
// `slug` must be one of HELP_DOC_SLUGS in big-picture-api/main.py.
// `anchor` (optional) is a heading id inside that doc to scroll straight to
// — useful for Settings sub-pages, where one shared "settings" guide covers
// ~20 sub-pages and each should jump to its own section.
// Styling mirrors the existing Overview-widget info button (WidgetHeader in
// App.jsx) — the app's own established "info" affordance.
export default function HelpIcon({ slug, anchor, theme, title = 'Help', className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/8 transition-colors shrink-0 ${className}`}
        style={{ color: theme.textMuted }}
      >
        <Info size={13} />
      </button>
      {open && <HelpModal slug={slug} anchor={anchor} theme={theme} onClose={() => setOpen(false)} />}
    </>
  );
}
