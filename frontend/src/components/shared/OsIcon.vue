<script setup lang="ts">
// 1:1 port of App.jsx's `OsIcon` function (~line 208-231) — the small
// platform-logo SVGs used next to OS totals (widget header badges, line
// widget footer, device rows). Kept as its own component since it's now
// needed in the Overview widget header/footer as well as Devices.
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    platform: string;
    size?: number;
    color?: string;
    isDarkMode?: boolean;
  }>(),
  { size: 16, isDarkMode: false }
);

const OFFICIAL_OS_COLORS = { apple: "#1D1D1F", android: "#3DDC84", windows: "#0241E2" };
function getAppleColor(isDark: boolean): string {
  return isDark ? "#E5E7EB" : "#1D1D1F";
}

const p = computed(() => props.platform.toLowerCase());
const kind = computed<"apple" | "android" | "windows" | "other">(() => {
  const v = p.value;
  if (v.includes("apple") || v.includes("ios") || v.includes("mac") || v.includes("ipad")) return "apple";
  if (v.includes("android") || v.includes("emm")) return "android";
  if (v.includes("win")) return "windows";
  return "other";
});
const fillColor = computed(() => {
  if (props.color) return props.color;
  if (kind.value === "apple") return getAppleColor(props.isDarkMode);
  if (kind.value === "android") return OFFICIAL_OS_COLORS.android;
  if (kind.value === "windows") return OFFICIAL_OS_COLORS.windows;
  return props.color;
});
</script>

<template>
  <svg v-if="kind === 'apple'" :width="size" :height="size" viewBox="2 1.5 20 19" :fill="fillColor">
    <path
      d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.04 2.34-.84 3.73-.81 1.26.06 2.3.49 3.03 1.3-2.6 1.42-2.14 4.54.44 5.56-.63 1.95-1.63 4.2-2.28 5.12zM12.03 7.25C11.83 4.4 14.12 2.35 16.14 2c.28 2.56-2.28 4.88-4.11 5.25z"
    />
  </svg>
  <svg v-else-if="kind === 'android'" :width="size" :height="size" viewBox="1 2 22 17" :fill="fillColor">
    <path
      d="M17.6 9.48l1.84-3.18a.68.68 0 0 0-.25-.93.67.67 0 0 0-.93.25l-1.88 3.25a11.17 11.17 0 0 0-8.76 0L5.74 5.62a.67.67 0 0 0-.93-.25.68.68 0 0 0-.25.93l1.84 3.18A11.53 11.53 0 0 0 1.2 18.6h21.6a11.5 11.5 0 0 0-5.2-9.12zM7.33 15.46a1.44 1.44 0 1 1 1.44-1.44 1.44 1.44 0 0 1-1.44 1.44zm9.34 0a1.44 1.44 0 1 1 1.44-1.44 1.44 1.44 0 0 1-1.44 1.44z"
    />
  </svg>
  <svg v-else-if="kind === 'windows'" :width="size" :height="size" viewBox="0 0 24 24" :fill="fillColor">
    <path d="M0 0h11.4v11.4H0V0zm12.6 0H24v11.4H12.6V0zM0 12.6h11.4V24H0V12.6zm12.6 0H24V24H12.6V12.6z" />
  </svg>
  <!-- Fallback for unrecognized platforms — App.jsx's OsIcon falls back to
       a generic <Layout> glyph (App.jsx:229) for anything that isn't
       apple/android/windows. -->
  <svg v-else :width="size" :height="size" viewBox="0 0 24 24" fill="none" :stroke="fillColor || 'currentColor'">
    <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="1.6" />
    <line x1="3" y1="9" x2="21" y2="9" stroke-width="1.6" />
    <line x1="9" y1="9" x2="9" y2="21" stroke-width="1.6" />
  </svg>
</template>
