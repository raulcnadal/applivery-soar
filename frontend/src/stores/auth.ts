import { defineStore } from "pinia";
import { computed, ref } from "vue";

/**
 * Holds both independent tokens from the original app's auth model
 * (ARCHITECTURE.md §1.3), ported to Pinia in place of prop-drilled state:
 *   1. dashboardToken — this app's own 30-day gate JWT.
 *   2. apiToken/refreshToken (+ expiry) — the user's real Applivery session,
 *      forwarded explicitly as `Authorization: Bearer <apiToken>` on every
 *      call site (both to this app's own backend, alongside
 *      X-Workspace-Slug, and to api.applivery.io directly).
 *
 * Populated in full during Phase 1 (login flow + resolve-access). This is
 * the Phase 0 shape only.
 */
export const useAuthStore = defineStore("auth", () => {
  const dashboardToken = ref<string | null>(localStorage.getItem("applivery_dashboard_token"));
  const apiToken = ref<string | null>(localStorage.getItem("applivery_apiToken"));
  const refreshToken = ref<string | null>(localStorage.getItem("applivery_refreshToken"));
  const orgSlug = ref<string | null>(localStorage.getItem("applivery_orgSlug"));
  const email = ref<string | null>(localStorage.getItem("applivery_email"));

  const isAuthenticated = computed(() => Boolean(dashboardToken.value && apiToken.value));

  function persistSession(payload: {
    dashboardToken: string;
    apiToken: string;
    refreshToken: string;
    orgSlug: string;
    email: string;
  }) {
    dashboardToken.value = payload.dashboardToken;
    apiToken.value = payload.apiToken;
    refreshToken.value = payload.refreshToken;
    orgSlug.value = payload.orgSlug;
    email.value = payload.email;

    localStorage.setItem("applivery_dashboard_token", payload.dashboardToken);
    localStorage.setItem("applivery_apiToken", payload.apiToken);
    localStorage.setItem("applivery_refreshToken", payload.refreshToken);
    localStorage.setItem("applivery_orgSlug", payload.orgSlug);
    localStorage.setItem("applivery_email", payload.email);
  }

  function clearSession() {
    dashboardToken.value = null;
    apiToken.value = null;
    refreshToken.value = null;
    orgSlug.value = null;
    email.value = null;
    localStorage.clear();
  }

  return {
    dashboardToken,
    apiToken,
    refreshToken,
    orgSlug,
    email,
    isAuthenticated,
    persistSession,
    clearSession,
  };
});
