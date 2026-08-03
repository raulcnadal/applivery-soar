// Shared chart color/label helpers for the WidgetInfoModal (App.jsx's
// `_colorFor`/`_humanLabel`, ~lines 3757-3799) — kept in its own module so
// both the modal and any future chart consumer can share them, rather than
// re-deriving colors ad hoc. Light-theme only for now: dark mode itself
// isn't ported yet (roadmap Phase 11), so this uses the original's
// light-theme chartPalette/getAppleColor(false) branch verbatim.
const CHART_PALETTE = ["#8B5CF6", "#3B82F6", "#06B6D4", "#22C55E", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6"];

const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";
const PRIMARY_BLUE = "#0241E3";

const APPLE_COLOR = "#1D1D1F"; // getAppleColor(false) — light theme
const OFFICIAL_OS_COLORS = { apple: APPLE_COLOR, android: "#3DDC84", windows: "#0241E2" };

/** Port of App.jsx's `_colorFor(stat, key, i)` (~3757-3785). `stat` is
 * unused by every current branch (same as the original, whose own
 * `stat === 'stats_os_updates_all'` check resolves to the identical
 * fallback either way) — kept in the signature for call-site parity with
 * the original and any future stat-specific branch. */
export function colorFor(_stat: string, key: string, i: number): string {
  const k = String(key).toUpperCase();
  // Battery levels
  if (k.includes("MORE THAN 70")) return "#22C55E";
  if (k.includes("BETWEEN")) return "#F59E0B";
  if (k.includes("LESS THAN 20")) return "#EF4444";
  // Compliance
  if (k.includes("NON") || k.includes("NOT COMPLI")) return DANGER;
  if (k === "COMPLIANT" || k === "COMPLIANCE" || k.includes("COMPLIAN")) return SUCCESS;
  // Device status — each gets a distinct semantic colour
  if (k === "ACTIVE") return "#22C55E";
  if (k === "INACTIVE") return "#F59E0B";
  if (k === "PENDING") return "#3B82F6";
  if (k === "DISABLED") return "#9CA3AF";
  if (k === "BLOCKED") return "#EF4444";
  if (k.includes("MEDIUM")) return WARNING;
  // OS colours
  if (k.includes("APPLE") || k.includes("IOS") || k.includes("MAC")) return OFFICIAL_OS_COLORS.apple;
  if (k.includes("ANDROID")) return OFFICIAL_OS_COLORS.android;
  if (k.includes("WINDOWS") || k.includes("WIN")) return OFFICIAL_OS_COLORS.windows;
  // Collaborator roles
  if (k === "ADMIN") return "#A855F7";
  if (k === "EDITOR") return "#3B82F6";
  if (k === "VIEWER") return "#06B6D4";
  if (k === "OWNER") return PRIMARY_BLUE;
  if (k === "UNASSIGNED") return "#9CA3AF";

  return CHART_PALETTE[i % CHART_PALETTE.length];
}

/** Port of App.jsx's `_humanLabel(raw)` (~3789-3799). */
export function humanLabel(raw: string): string {
  const k = String(raw).toUpperCase();
  if (k.includes("APPLE") || k.includes("IOS")) return "Apple";
  if (k.includes("ANDROID")) return "Android";
  if (k.includes("WIN")) return "Windows";
  if (k.includes("MAC")) return "macOS";
  if (k === "ACTIVE") return "Active";
  if (k === "INACTIVE") return "Inactive";
  if (k === "DISABLED") return "Disabled";
  if (k.includes("COMPLIANCE") || k.includes("COMPLIANT")) return raw;
  if (k.includes("ADMIN")) return "Admin";
  if (k.includes("EDITOR")) return "Editor";
  if (k.includes("VIEWER")) return "Viewer";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Lighten a hex color by `amt` (0-1) toward white. Port of App.jsx's `brighten`. */
export function brighten(hex: string, amt = 0.18): string {
  if (!hex || !hex.startsWith("#")) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * amt));
  return `#${mix(r).toString(16).padStart(2, "0")}${mix(g).toString(16).padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`;
}

export { PRIMARY_BLUE };
