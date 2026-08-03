// Segment icon/color resolution — port of App.jsx's getSegmentIcon (1748-1776)
// and getSegmentColor (1785-1796). Each segment's icon/color is whatever an
// admin picked in Applivery's own segment-configuration UI, not part of this
// app's own designed visual language — a numeric index into a fixed ~78-icon
// array, or a substring-matched icon name, resolved down to whichever of our
// existing solar-icons registry entries is the closest semantic match (this
// app doesn't import ~30 new icon names just for a decorative per-segment
// glyph). Falls back to BookmarkSquare exactly like the original's own
// default.
import { ICONS, type IconName } from "./solarIcons";

// Numeric-index cycle — a reduced stand-in for the original's 78-entry
// iconArray, built only from names already in this app's ICONS registry.
const ICON_CYCLE: IconName[] = [
  "Folder", "Box", "Bug", "Buildings2", "Bell", "Bolt", "BookmarkSquare", "Calendar",
  "Case", "Chart2", "ChatRound", "CheckCircle", "CloseCircle", "DangerTriangle",
  "ClockCircle", "Refresh", "CodeFile", "Cpu", "DocumentText", "SliderHorizontal",
  "Flag", "Hourglass", "Lock", "LockUnlocked", "MapPoint", "Smartphone", "Global",
  "Radio", "Satellite", "ShieldCheck", "Tag", "TrashBinTrash", "UserCircle",
  "Target", "Pulse", "PieChart", "Radar",
];

// Substring-matched name -> icon, ordered same-ish as the original's iconMap.
const ICON_SUBSTRING_MAP: Array<[string, IconName]> = [
  ["folder", "Folder"], ["bag", "Case"], ["shop", "Case"], ["battery", "BatteryCharge"],
  ["bell", "Bell"], ["zap", "Bolt"], ["lightning", "Bolt"], ["bookmark", "BookmarkSquare"],
  ["mark", "BookmarkSquare"], ["package", "Box"], ["cube", "Box"], ["box", "Box"],
  ["bug", "Bug"], ["insect", "Bug"], ["building", "Buildings2"], ["city", "Buildings2"],
  ["calendar", "Calendar"], ["date", "Calendar"], ["case", "Case"], ["briefcase", "Case"],
  ["work", "Case"], ["chart", "Chart2"], ["bar", "Chart2"], ["chat", "ChatRound"],
  ["message", "ChatRound"], ["check", "CheckCircle"], ["tick", "CheckCircle"],
  ["close", "CloseCircle"], ["cross", "CloseCircle"], ["alert", "DangerTriangle"],
  ["warning", "DangerTriangle"], ["danger", "DangerTriangle"], ["timer", "ClockCircle"],
  ["stopwatch", "ClockCircle"], ["clock", "ClockCircle"], ["time", "ClockCircle"],
  ["refresh", "Refresh"], ["sync", "Refresh"], ["code", "CodeFile"], ["cpu", "Cpu"],
  ["chip", "Cpu"], ["file", "DocumentText"], ["document", "DocumentText"],
  ["filter", "SliderHorizontal"], ["slider", "SliderHorizontal"], ["flag", "Flag"],
  ["hourglass", "Hourglass"], ["lock", "Lock"], ["unlock", "LockUnlocked"],
  ["pin", "MapPoint"], ["location", "MapPoint"], ["device", "Smartphone"],
  ["phone", "Smartphone"], ["smartphone", "Smartphone"], ["mobile", "Smartphone"],
  ["globe", "Global"], ["world", "Global"], ["planet", "Global"], ["radio", "Radio"],
  ["satellite", "Satellite"], ["shield", "ShieldCheck"], ["secure", "ShieldCheck"],
  ["tag", "Tag"], ["label", "Tag"], ["trash", "TrashBinTrash"], ["delete", "TrashBinTrash"],
  ["user", "UserCircle"], ["person", "UserCircle"], ["target", "Target"],
  ["activity", "Pulse"], ["pie", "PieChart"], ["radar", "Radar"],
];

export function getSegmentIcon(iconValue: unknown) {
  if (iconValue === undefined || iconValue === null) return ICONS.BookmarkSquare;
  const val = String(iconValue).trim().toLowerCase();
  const name = val.startsWith("i") ? val.substring(1) : val;

  if (/^\d+$/.test(val)) {
    const idx = parseInt(val, 10);
    return ICONS[ICON_CYCLE[idx % ICON_CYCLE.length]] ?? ICONS.BookmarkSquare;
  }

  for (const [key, iconName] of ICON_SUBSTRING_MAP) {
    if (name.includes(key) || val.includes(key)) return ICONS[iconName];
  }
  return ICONS.BookmarkSquare;
}

// 1:1 port of APPLIVERY_COLOR_MAP (App.jsx:1789-1794).
const APPLIVERY_COLOR_MAP: Record<string, string> = {
  "#000000": "#737373", "#000001": "#F87171", "#000002": "#FB923C", "#000004": "#FACC15",
  "#000005": "#A3E635", "#000007": "#34D399", "#000009": "#22D3EE", "#000011": "#60A5FA",
  "#000014": "#C084FC", "#000016": "#F472B6",
};

export function getSegmentColor(colorVal: unknown, fallback = "#9CA3AF"): string {
  if (!colorVal) return fallback;
  const rawColor = String(colorVal).trim().toLowerCase();
  if (APPLIVERY_COLOR_MAP[rawColor]) return APPLIVERY_COLOR_MAP[rawColor];
  if (/^#([0-9a-f]{3}){1,2}$/.test(rawColor)) return rawColor;
  return fallback;
}
