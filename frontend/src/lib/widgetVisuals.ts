// Shared chart color/label helpers for the WidgetInfoModal (App.jsx's
// `_colorFor`/`_humanLabel`, ~lines 3757-3799) — kept in its own module so
// both the modal and any future chart consumer can share them, rather than
// re-deriving colors ad hoc.
const CHART_PALETTE = ["#8B5CF6", "#3B82F6", "#06B6D4", "#22C55E", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6"];

const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";
const PRIMARY_BLUE = "#0241E3";

// Port of App.jsx's `getAppleColor(isDarkMode)` (~line 206): '#1D1D1F' in
// light mode, '#E5E7EB' in dark mode (a near-black "Apple black" reads as
// near-invisible on a dark card, so the original swaps it for a light grey).
function getAppleColor(isDark: boolean): string {
  return isDark ? "#E5E7EB" : "#1D1D1F";
}
const OFFICIAL_OS_COLORS = { android: "#3DDC84", windows: "#0241E2" };

/** Port of App.jsx's `_colorFor(stat, key, i)` (~3757-3785). `stat` is
 * unused by every current branch (same as the original, whose own
 * `stat === 'stats_os_updates_all'` check resolves to the identical
 * fallback either way) — kept in the signature for call-site parity with
 * the original and any future stat-specific branch. `isDark` defaults to
 * `false` for call sites that don't (yet) thread the theme through, but
 * every live consumer should pass `useUiStore().isDark.value` — the Apple/
 * iOS/macOS branch below is the only one that's actually theme-dependent. */
export function colorFor(_stat: string, key: string, i: number, isDark = false): string {
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
  if (k.includes("APPLE") || k.includes("IOS") || k.includes("MAC")) return getAppleColor(isDark);
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

/** Port of App.jsx's `_getOsPlatform(stat, name, itemOs)` (~3800-3806). */
export function getOsPlatform(_stat: string, name: string, itemOs?: string | null): string | null {
  if (itemOs) return itemOs;
  const n = String(name).toLowerCase();
  if (n === "apple" || n === "ios" || n.includes("mac") || n.includes("ipad")) return "apple";
  if (n === "android") return "android";
  if (n === "windows" || n === "win") return "windows";
  return null;
}

/** Port of App.jsx's `handleChartClick`'s filter dispatch (~3682-3747) — given
 * a widget, its raw `items`, and the name of the slice/bar/row clicked (or
 * `null` for a click on a non-sliced chart like scorecard/line/radar),
 * returns the subset of items that slice represents. Splitting the pure
 * filter logic out from the click-handling/state-setting lets WidgetCard.vue
 * (the live grid card) and any future consumer share it without either
 * owning the `selectedWidgetItems` state itself. */
export function filterWidgetItemsForClick(widget: { stat: string }, items: any[], sliceName: string | null): any[] {
  if (!sliceName) return items;
  const name = String(sliceName).toLowerCase().trim();
  const stat = widget.stat;

  if (stat === "stats_compliance") {
    const wantComp = name === "compliant" || name === "compliance";
    return items.filter((i) => i.is_compliant_normalized === wantComp);
  }
  if (stat === "stats_devices_os" || stat === "mdm_devices" || stat === "stats_builds_os" || stat === "app_dist_apps") {
    return items.filter((i) => {
      const p_str = JSON.stringify(i.oss || [i.platform_normalized || i.os]).toLowerCase();
      if (name.includes("ios") || name.includes("apple") || name.includes("ipad") || name.includes("mac")) return p_str.includes("apple") || p_str.includes("ios") || p_str.includes("mac");
      if (name.includes("win")) return p_str.includes("windows") || p_str.includes("win");
      if (name.includes("android")) return p_str.includes("android");
      return p_str.includes("other");
    });
  }
  if (stat === "stats_devices_status") {
    return items.filter((i) => i.state_normalized === name);
  }
  if (stat.includes("collaborator") || stat.includes("role") || stat === "mdm_users" || stat === "app_dist_store_users") {
    return items.filter((i) => String(i.role_normalized || "user").toLowerCase() === name);
  }
  if (stat === "stats_models") {
    return items.filter((i) => {
      const mfr = String(i.summary?.manufacturer || i.summary?.brand || "").toLowerCase();
      const mod = String(i.summary?.model || i.summary?.name || "").toLowerCase();
      const combined = `${mfr} ${mod}`;
      return combined.includes(name) || name.includes(mod);
    });
  }
  if (stat === "mdm_segments") {
    return items.filter((i) => String(i.name || "").toLowerCase() === name);
  }
  if (stat === "stats_battery") {
    return items.filter((i) => {
      const bat = parseFloat(i.summary?.battery);
      if (isNaN(bat)) return false;
      if (name.includes("less than 20")) return bat >= 0 && bat <= 20;
      if (name.includes("between")) return bat > 20 && bat <= 70;
      if (name.includes("more than 70")) return bat > 70;
      return false;
    });
  }
  if (stat === "stats_os_updates_all" || stat === "stats_os_versions") {
    return items.filter((i) => {
      const ver = String(i.version || i.osVersion || i.targetVersion || i.value || i.summary?.osVersion || "Unknown").toLowerCase().trim();
      return name.includes(ver);
    });
  }
  if (stat === "stats_sync_errors") {
    return items.filter((i) => {
      const target = String(i.target || "Unknown").replace(/device/i, "").toLowerCase().trim();
      return name.includes(target);
    });
  }
  if (stat === "cases_summary") {
    const statusByLabel: Record<string, string> = { open: "open", investigating: "investigating", resolved: "resolved", closed: "closed", "false positive": "false_positive" };
    const wantStatus = statusByLabel[name] || name;
    return items.filter((i) => String(i.status || "").toLowerCase() === wantStatus);
  }
  return items;
}

/** Port of App.jsx's item-shape sniffing used by both the `selectedWidgetItems`
 * results list (getDisplayName/subLabel, ~5364-5388) and the `activeInsight`
 * detail dispatch (~3988-4111) to tell a device/app/build/download/segment/
 * generic-user record apart — these payload shapes never carry an explicit
 * "type" field, so both places re-derive it from which fields are present. */
export function insightKind(item: Record<string, any>): "segment" | "download" | "build" | "device" | "app" | "user" {
  if (item.type_normalized === "segment") return "segment";
  if (item.member !== undefined && item.networkInfo !== undefined) return "download";
  if (item.versionName !== undefined && (item.applicationInfo !== undefined || item.os !== undefined || item.originalExtension !== undefined)) return "build";
  const isDevice = !!(
    item.platform_normalized ||
    item.summary?.serialNumber ||
    item.summary?.udid ||
    item.control?.UDID ||
    item.emmDevice ||
    item.admEnterprise ||
    item.winId ||
    (item.type && ["android", "apple", "ios", "windows", "macos"].includes(String(item.type).toLowerCase()))
  );
  if (isDevice) return "device";
  if (item.oss !== undefined && item.buildPlatforms !== undefined) return "app";
  return "user";
}

/** Port of App.jsx's `getDisplayName`/subLabel logic inside the
 * `selectedWidgetItems` results-list render (~5364-5388). */
export function widgetResultRowLabel(item: Record<string, any>): { label: string; subLabel: string; kind: ReturnType<typeof insightKind> } {
  const kind = insightKind(item);
  let label: string;
  if (item.display_name) label = item.display_name;
  else if (kind === "segment") label = item.name || "Unnamed Segment";
  else if (kind === "build") label = item.applicationInfo?.name || item.application || "Unknown App";
  else if (kind === "download") label = `${item.member?.firstName || ""} ${item.member?.lastName || ""}`.trim() || item.member?.email || "Unknown Downloader";
  else {
    const target = item.user || item.employee || item;
    if (target.firstName || target.lastName) label = `${target.firstName || ""} ${target.lastName || ""}`.trim();
    else if (target.name) label = target.name;
    else if (item.name) label = item.name;
    else if (item.displayName) label = item.displayName;
    else label = target.email || item.email || item.summary?.model || "Unknown Item";
  }

  let subLabel = "";
  if (kind === "segment") subLabel = `ID: ${item.id} · Children: ${item.children?.length || 0}`;
  else if (kind === "build") subLabel = `v${item.versionName} (${item.versionCode}) · ${item.os || "Unknown"}`;
  else if (kind === "download") subLabel = `IP: ${item.networkInfo?.ip || "N/A"} · ${item.applicationInfo?.name || "App"}`;
  else if (item.oss && Array.isArray(item.oss)) subLabel = item.oss.join(" · ").toUpperCase();
  else subLabel = item.display_email || item.email || item.user?.email || item.employee?.email || item.platform_normalized || item.summary?.osVersion || "";

  return { label, subLabel, kind };
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
