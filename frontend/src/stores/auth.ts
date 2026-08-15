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
  | "canBulkTriage"
  | "canManageMtlsCA";

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
  // Expiry timestamps for the two tokens above — needed by the Workspace
  // Automation settings panel's "Use this session for automation" action
  // (POST /api/settings/automation-credential expects them so the stored
  // credential knows when it needs to self-refresh). Not used for anything
  // else client-side; same sensitivity tier as the tokens themselves.
  const apiTokenExpireAt = ref<string | null>(localStorage.getItem("applivery_apiTokenExpireAt"));
  const refreshTokenExpireAt = ref<string | null>(localStorage.getItem("applivery_refreshTokenExpireAt"));
  const orgSlug = ref<string | null>(localStorage.getItem("applivery_orgSlug"));
  const email = ref<string | null>(localStorage.getItem("applivery_email"));
  // Read-only profile fields for the Account settings panel (docs/settings.md#account)
  // — Applivery's login response includes these, the original frontend just
  // never persisted them past the login screen.
  const fullName = ref<string | null>(localStorage.getItem("applivery_fullName"));
  const avatarUrl = ref<string | null>(localStorage.getItem("applivery_avatarUrl"));
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
    apiTokenExpireAt?: string | null;
    refreshTokenExpireAt?: string | null;
    orgSlug: string;
    email: string;
    fullName?: string | null;
    avatarUrl?: string | null;
    organizations?: Organization[];
  }) {
    dashboardToken.value = payload.dashboardToken;
    apiToken.value = payload.apiToken;
    refreshToken.value = payload.refreshToken;
    apiTokenExpireAt.value = payload.apiTokenExpireAt ?? null;
    refreshTokenExpireAt.value = payload.refreshTokenExpireAt ?? null;
    orgSlug.value = payload.orgSlug;
    email.value = payload.email;
    if (payload.fullName !== undefined) fullName.value = payload.fullName ?? null;
    if (payload.avatarUrl !== undefined) avatarUrl.value = payload.avatarUrl ?? null;
    if (payload.organizations) organizations.value = payload.organizations;

    localStorage.setItem("applivery_dashboard_token", payload.dashboardToken);
    localStorage.setItem("applivery_apiToken", payload.apiToken);
    localStorage.setItem("applivery_refreshToken", payload.refreshToken);
    if (payload.apiTokenExpireAt) localStorage.setItem("applivery_apiTokenExpireAt", payload.apiTokenExpireAt);
    if (payload.refreshTokenExpireAt) localStorage.setItem("applivery_refreshTokenExpireAt", payload.refreshTokenExpireAt);
    localStorage.setItem("applivery_orgSlug", payload.orgSlug);
    localStorage.setItem("applivery_email", payload.email);
    if (payload.fullName) localStorage.setItem("applivery_fullName", payload.fullName);
    if (payload.avatarUrl) localStorage.setItem("applivery_avatarUrl", payload.avatarUrl);
    if (payload.organizations) localStorage.setItem("applivery_organizations", JSON.stringify(payload.organizations));
  }

  /**
   * Switch to a sibling Applivery organization without a full re-login —
   * same session tokens, just a different X-Workspace-Slug going forward.
   * Docs/settings.md#account's "Workspace switcher". Callers should reload
   * the page after this resolves so every store re-fetches clean against
   * the newly active workspace (same pattern AppShell.vue's onCloned uses).
   */
  async function switchWorkspace(slug: string) {
    orgSlug.value = slug;
    localStorage.setItem("applivery_orgSlug", slug);
    await resolveAccess();
  }

  function clearSession() {
    dashboardToken.value = null;
    apiToken.value = null;
    refreshToken.value = null;
    apiTokenExpireAt.value = null;
    refreshTokenExpireAt.value = null;
    orgSlug.value = null;
    email.value = null;
    fullName.value = null;
    avatarUrl.value = null;
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
      appliveryAccessTokenExpireAt?: string;
      appliveryRefreshToken: string;
      appliveryRefreshTokenExpireAt?: string;
      user: { email: string; fullName?: string; picture?: string };
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

  // De-duped so several concurrent 401s (or the proactive expiry check in
  // composables/useSessionGuards.ts racing a request that itself just
  // triggered a refresh) only ever fire one real POST /api/auth/refresh.
  // 1:1 port of the original App.jsx's refreshAppliverySession()
  // (wow-dashboard/src/App.jsx ~89-111), which this Vue port never had at
  // all -- without it, the Applivery access token (much shorter-lived than
  // this app's own 30-day dashboard JWT) just expired on its own schedule
  // with nothing renewing it.
  let refreshInFlight: Promise<boolean> | null = null;
  async function refreshAppliverySession(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      if (!apiToken.value || !refreshToken.value) return false;
      try {
        const res = await axios.post("/api/auth/refresh", {
          lastAccessToken: apiToken.value,
          refreshToken: refreshToken.value,
        });
        apiToken.value = res.data.appliveryAccessToken;
        apiTokenExpireAt.value = res.data.appliveryAccessTokenExpireAt ?? null;
        refreshToken.value = res.data.appliveryRefreshToken ?? refreshToken.value;
        refreshTokenExpireAt.value = res.data.appliveryRefreshTokenExpireAt ?? null;

        localStorage.setItem("applivery_apiToken", apiToken.value as string);
        if (apiTokenExpireAt.value) localStorage.setItem("applivery_apiTokenExpireAt", apiTokenExpireAt.value);
        localStorage.setItem("applivery_refreshToken", refreshToken.value as string);
        if (refreshTokenExpireAt.value) localStorage.setItem("applivery_refreshTokenExpireAt", refreshTokenExpireAt.value);
        return true;
      } catch {
        return false;
      }
    })();
    const result = await refreshInFlight;
    refreshInFlight = null;
    return result;
  }

  return {
    dashboardToken,
    apiToken,
    refreshToken,
    apiTokenExpireAt,
    refreshTokenExpireAt,
    orgSlug,
    email,
    fullName,
    avatarUrl,
    access,
    organizations,
    isAuthenticated,
    persistSession,
    clearSession,
    login,
    resolveAccess,
    switchWorkspace,
    hasFeatureAccess,
    hasRiskyAction,
    refreshAppliverySession,
  };
});
