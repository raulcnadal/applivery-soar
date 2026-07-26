import axios from "axios";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type FeatureArea =
  | "devices"
  | "compliance"
  | "workflows"
  | "cases"
  | "integrations"
  | "reporting"
  | "settings"
  | "auditLog";
export type FeatureLevel = "none" | "read" | "manage";
export type RiskyAction =
  | "canDeletePolicyOrWorkflow"
  | "canRunDestructiveWorkflow"
  | "canEditIntegrationSecrets"
  | "canExportOrImportConfig"
  | "canBulkTriage";

export interface SoarRole {
  id: string;
  name: string;
  featureAccess: Partial<Record<FeatureArea, FeatureLevel>>;
  riskyActions: Partial<Record<RiskyAction, boolean>>;
}

export interface ResolvedAccess {
  allowed: boolean;
  isSuperAdmin: boolean;
  role: SoarRole | null;
  collaboratorRole: string | null;
  matchedTagValue: string | null;
  deniedReason: string | null;
}

export interface Organization {
  _id?: string;
  id?: string;
  slug?: string;
  name?: string;
}

const FEATURE_LEVEL_RANK: Record<FeatureLevel, number> = { none: 0, read: 1, manage: 2 };

/**
 * Holds both independent tokens from the original app's auth model
 * (ARCHITECTURE.md §1.3):
 *   1. dashboardToken — this app's own 30-day gate JWT.
 *   2. apiToken/refreshToken (+ expiry) — the user's real Applivery session,
 *      forwarded as `Authorization: Bearer <apiToken>` + `X-Workspace-Slug`
 *      on every call to this app's own backend (see src/api/http.ts).
 *
 * Plus the resolved RBAC `access` object (POST /api/auth/resolve-access) —
 * a UX layer only, mirroring hasFeatureAccess/hasRiskyAction from the
 * original App.jsx (ARCHITECTURE.md §1.6). The real enforcement boundary is
 * always the backend's requirePermission middleware; never rely on this for
 * anything that matters.
 */
export const useAuthStore = defineStore("auth", () => {
  const dashboardToken = ref<string | null>(localStorage.getItem("applivery_dashboard_token"));
  const apiToken = ref<string | null>(localStorage.getItem("applivery_apiToken"));
  const refreshToken = ref<string | null>(localStorage.getItem("applivery_refreshToken"));
  const orgSlug = ref<string | null>(localStorage.getItem("applivery_orgSlug"));
  const email = ref<string | null>(localStorage.getItem("applivery_email"));
  const access = ref<ResolvedAccess | null>(null);
  // The full sibling-workspace list from login's `organizations` response —
  // the original app never persisted this either, but this port's onboarding
  // modal (WorkspaceOnboardingModal.vue, Phase 8) needs it to offer
  // "copy config from workspace X" without a second API round-trip. Not
  // sensitive (just names/slugs the account already has access to), so
  // localStorage is fine, same tier as orgSlug/email above.
  const organizations = ref<Organization[]>(JSON.parse(localStorage.getItem("applivery_organizations") ?? "[]"));

  const isAuthenticated = computed(() => Boolean(dashboardToken.value && apiToken.value));

  function persistSession(payload: {
    dashboardToken: string;
    apiToken: string;
    refreshToken: string;
    orgSlug: string;
    email: string;
    organizations?: Organization[];
  }) {
    dashboardToken.value = payload.dashboardToken;
    apiToken.value = payload.apiToken;
    refreshToken.value = payload.refreshToken;
    orgSlug.value = payload.orgSlug;
    email.value = payload.email;
    if (payload.organizations) organizations.value = payload.organizations;

    localStorage.setItem("applivery_dashboard_token", payload.dashboardToken);
    localStorage.setItem("applivery_apiToken", payload.apiToken);
    localStorage.setItem("applivery_refreshToken", payload.refreshToken);
    localStorage.setItem("applivery_orgSlug", payload.orgSlug);
    localStorage.setItem("applivery_email", payload.email);
    if (payload.organizations) localStorage.setItem("applivery_organizations", JSON.stringify(payload.organizations));
  }

  function clearSession() {
    dashboardToken.value = null;
    apiToken.value = null;
    refreshToken.value = null;
    orgSlug.value = null;
    email.value = null;
    access.value = null;
    organizations.value = [];
    localStorage.clear();
  }

  /** POST /api/auth/login — thin proxy to Applivery's own login API. */
  async function login(credentials: { email: string; password: string; twoFactorCode?: string }) {
    const res = await axios.post("/api/auth/login", credentials);
    return res.data as {
      access_token: string;
      appliveryAccessToken: string;
      appliveryRefreshToken: string;
      user: { email: string };
      organizations: Organization[];
      currentOrganizationId?: string;
    };
  }

  /**
   * POST /api/auth/resolve-access — called right after login and right
   * after every workspace switch (ARCHITECTURE.md §1.6). Requires the
   * dashboard token + apiToken + orgSlug to already be persisted, since the
   * shared `api` client (src/api/http.ts) attaches them automatically.
   */
  async function resolveAccess() {
    const { api } = await import("../api/http");
    const res = await api.post<ResolvedAccess>("/auth/resolve-access");
    access.value = res.data;
    return res.data;
  }

  function hasFeatureAccess(area: FeatureArea, level: FeatureLevel = "read"): boolean {
    if (!access.value?.allowed) return false;
    if (access.value.isSuperAdmin) return true;
    const have = FEATURE_LEVEL_RANK[access.value.role?.featureAccess?.[area] ?? "none"];
    return have >= FEATURE_LEVEL_RANK[level];
  }

  function hasRiskyAction(action: RiskyAction): boolean {
    if (!access.value?.allowed) return false;
    if (access.value.isSuperAdmin) return true;
    return Boolean(access.value.role?.riskyActions?.[action]);
  }

  return {
    dashboardToken,
    apiToken,
    refreshToken,
    orgSlug,
    email,
    access,
    organizations,
    isAuthenticated,
    persistSession,
    clearSession,
    login,
    resolveAccess,
    hasFeatureAccess,
    hasRiskyAction,
  };
});
