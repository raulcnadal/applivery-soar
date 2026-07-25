// Shared BlueSky-aligned color tokens. Values copied verbatim from Applivery's
// BlueSky design system (globals.css `@theme` block + component reference
// docs) rather than re-derived, so hex values stay a single source of truth.
// Existing files each keep their own local PRIMARY_BLUE/SUCCESS/DANGER/WARNING
// constants for the exact brand-600 / semantic-600 value (so nothing needs
// rewiring), but anything that needs a full tint/shade — buttons' discrete
// hover states, badge pill backgrounds, alert banners — should import the
// scales below instead of hand-rolling `${PRIMARY_BLUE}NN` alpha blends.

export const BRAND = {
  50: '#edf2ff',
  100: '#dce7ff',
  200: '#bad0ff',
  300: '#7aaaff',
  400: '#3d79ff',
  500: '#1258ff',
  600: '#0241e3', // primary — buttons, links, active states
  700: '#0235c0', // hover on primary
  800: '#052a96',
  900: '#0a276e',
  950: '#071847',
};

// Tailwind's default green/amber/red/gray scales — BlueSky's badges, alerts,
// and status pills are built directly on these (bg-green-100 text-green-700,
// etc.), not on alpha-blended brand/semantic hexes.
export const GREEN = { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534' };
export const AMBER = { 50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e' };
export const RED   = { 50: '#fef2f2', 100: '#fee2e2', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b' };
export const GRAY  = {
  50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af',
  500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827', 950: '#030712',
};

// Neutral dark-mode surface/text tokens (docs.applivery.com pages.md "Dark Mode").
export const DARK = {
  canvas: GRAY[950],   // outermost dark background
  card: GRAY[800],     // cards, panels, sidebars, drawers, inputs
  elevated: GRAY[900], // modals/popovers on dark canvas
  border: GRAY[700],   // card/panel borders
  borderSubtle: GRAY[800],
  text: '#ffffff',
  textBody: GRAY[300],
  textMuted: GRAY[400],
  textCaption: GRAY[500],
  brandAccent: BRAND[400], // text-brand-400 on dark — NOT brand-600
};
