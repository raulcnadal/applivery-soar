import { defineStore } from "pinia";
import { computed, ref, watchEffect } from "vue";

export type ThemeMode = "light" | "dark" | "system";

const LIGHT_THEME = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#64748b",
  gridLine: "#e2e8f0",
};

const DARK_THEME = {
  bg: "#0b1220",
  card: "#111a2e",
  border: "#1f2a44",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  gridLine: "#1f2a44",
};

/**
 * Replaces App.jsx's THEME.light/dark + prop-drilled `theme` (ARCHITECTURE.md
 * §1.7) with a Pinia store any component can read via `useUiStore()` —
 * removes the need to thread `theme` through every component's props.
 */
export const useUiStore = defineStore("ui", () => {
  const themeMode = ref<ThemeMode>((localStorage.getItem("applivery_themeMode") as ThemeMode) ?? "system");
  const systemPrefersDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = ref(systemPrefersDark);

  const activeTheme = computed(() => {
    const resolved = themeMode.value === "system" ? (isDark.value ? "dark" : "light") : themeMode.value;
    return resolved === "dark" ? DARK_THEME : LIGHT_THEME;
  });

  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode;
  }

  watchEffect(() => {
    localStorage.setItem("applivery_themeMode", themeMode.value);
  });

  return { themeMode, activeTheme, setThemeMode };
});
