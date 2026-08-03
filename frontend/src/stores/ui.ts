import { defineStore } from "pinia";
import { computed, ref, watchEffect } from "vue";

export type ThemeMode = "light" | "dark" | "system";

// Port of App.jsx's THEME const (~lines 312-327) — light/dark palettes for
// every color still read from JS (inline :style, ECharts option builders)
// rather than a Tailwind utility class.
const LIGHT_THEME = {
  bg: "#F3F7FE",
  card: "#FFFFFF",
  border: "#E9EAEC",
  text: "#111827",
  textMuted: "#6B7280",
  chartPalette: ["#8B5CF6", "#3B82F6", "#06B6D4", "#22C55E", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6"],
  gridLine: "rgba(107, 114, 128, 0.1)",
};

const DARK_THEME = {
  bg: "#030712",
  card: "#1F2937",
  border: "#374151",
  text: "#FFFFFF",
  textMuted: "#9CA3AF",
  chartPalette: ["#A78BFA", "#60A5FA", "#22D3EE", "#4ADE80", "#FBBF24", "#F87171", "#F472B6", "#2DD4BF"],
  gridLine: "rgba(156, 163, 175, 0.1)",
};

/**
 * Replaces App.jsx's THEME.light/dark + themeMode/systemIsDark state
 * (~2804-2919) with a Pinia store any component can read via
 * `useUiStore()` — removes the need to thread `theme`/`activeTheme` through
 * every component's props the way the original does.
 *
 * Persistence mirrors the original exactly: localStorage as an instant
 * local fallback (`applivery_theme`, read on store creation so there's no
 * flash-of-wrong-theme before the backend round-trip resolves) *and* the
 * shared backend state (`/api/state`'s `themeMode` field, via
 * dashboardState.ts) as the durable, cross-device source of truth —
 * `syncFromBackend()` is called once AppShell has the backend value.
 */
export const useUiStore = defineStore("ui", () => {
  const themeMode = ref<ThemeMode>((localStorage.getItem("applivery_theme") as ThemeMode) ?? "system");

  const systemIsDark = ref(typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (typeof window !== "undefined") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", (e) => {
      systemIsDark.value = e.matches;
    });
  }

  const isDark = computed(() => themeMode.value === "dark" || (themeMode.value === "system" && systemIsDark.value));
  const activeTheme = computed(() => (isDark.value ? DARK_THEME : LIGHT_THEME));

  /** User-initiated change (the theme-menu clicks) — updates local state
   * immediately and pushes to the backend, same as the original's own
   * dashboard-state autosave (App.jsx:3407/3421 includes themeMode in the
   * debounced /api/state POST). */
  async function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode;
    const { useDashboardStateStore } = await import("./dashboardState");
    const store = useDashboardStateStore();
    store.saveState({ themeMode: mode }).catch(() => {
      /* non-critical — localStorage fallback already covers this device */
    });
  }

  /** Called once by AppShell after /api/state resolves — backend value wins
   * over the localStorage fallback if the two ever disagree (e.g. a theme
   * change made on another device). Deliberately bypasses setThemeMode so
   * this doesn't re-POST the value it just read. */
  function syncFromBackend(backendMode: string | null | undefined) {
    if (backendMode === "light" || backendMode === "dark" || backendMode === "system") {
      themeMode.value = backendMode;
    }
  }

  // Local fast-path persistence, same as the original's own
  // `localStorage.setItem('applivery_theme', themeMode)` effect.
  watchEffect(() => {
    localStorage.setItem("applivery_theme", themeMode.value);
  });

  // Apply/remove the `dark` class on <html> that Tailwind's custom `dark:`
  // variant (bluesky-tokens.css's `@custom-variant dark`) keys off of.
  watchEffect(() => {
    document.documentElement.classList.toggle("dark", isDark.value);
  });

  return { themeMode, isDark, activeTheme, setThemeMode, syncFromBackend };
});
