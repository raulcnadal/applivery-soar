import { signDashboardToken } from "../../middleware/auth.middleware";
import { appliveryClient } from "../../services/appliveryClient";
import { HttpError } from "../../utils/httpError";

/**
 * Ported from main.py lines 902-1012 ("UNIFIED AUTHENTICATION ENGINE").
 * Login is a thin proxy to Applivery's own Login API (traditional
 * email+password) — there is no local admin password. A successful
 * Applivery login gives us two independent things: (1) our own short-lived
 * dashboard JWT (sole gate on every /api/* route), and (2) the human's real
 * Applivery session (accessToken/refreshToken/organizations), which the
 * frontend stores and forwards per-request. SSO/Google/other providers are
 * intentionally NOT supported — our callback URL isn't registered with
 * Applivery for those.
 */

export interface LoginResult {
  access_token: string;
  appliveryAccessToken: string;
  appliveryAccessTokenExpireAt: string | undefined;
  appliveryRefreshToken: string | undefined;
  appliveryRefreshTokenExpireAt: string | undefined;
  user: { email: string | undefined; fullName: string | undefined; picture: string | undefined };
  organizations: unknown[];
  currentOrganizationId: string | undefined;
}

export async function loginWithApplivery(email: string, password: string, twoFactorCode?: string): Promise<LoginResult> {
  const body: { provider: string; payload: Record<string, string> } = {
    provider: "traditional",
    payload: { email, password },
  };
  if (twoFactorCode) body.payload.twoFactorCode = twoFactorCode;

  let res;
  try {
    res = await appliveryClient.post<any>("/auth/login", body);
  } catch (error: any) {
    throw new HttpError(502, { error: `Could not reach Applivery: ${error?.message ?? error}` });
  }

  const data = res.data ?? {};
  if (res.status !== 200 || !data.status) {
    const err = data.error ?? {};
    if (err.code === 4014) {
      // "Required two factor code" — frontend's MFA step.
      throw new HttpError(401, { error: "TWO_FACTOR_REQUIRED" });
    }
    throw new HttpError(401, { error: err.message || "Invalid email or password." });
  }

  const d = data.data ?? {};
  const access = d.accessToken ?? {};
  const refresh = d.refreshToken ?? {};
  const user = d.user ?? {};
  const organizations = user.organizations ?? [];

  if (!access.token) {
    throw new HttpError(502, { error: "Applivery login succeeded but returned no access token." });
  }

  // Our own dashboard-gate JWT — unrelated to the Applivery token above.
  // Subject is the real user's email, purely for audit/logging.
  const dashboardToken = signDashboardToken(user.email ?? "unknown");

  return {
    access_token: dashboardToken,
    appliveryAccessToken: access.token,
    appliveryAccessTokenExpireAt: access.expireAt,
    appliveryRefreshToken: refresh.token,
    appliveryRefreshTokenExpireAt: refresh.expireAt,
    user: { email: user.email, fullName: user.fullName, picture: user.picture },
    organizations,
    currentOrganizationId: user.organizationId,
  };
}

export interface RefreshResult {
  appliveryAccessToken: string;
  appliveryAccessTokenExpireAt: string | undefined;
  appliveryRefreshToken: string;
  appliveryRefreshTokenExpireAt: string | undefined;
}

/**
 * Shared core of POST /api/auth/refresh — also reused later by the
 * per-workspace automation credential refresher (Phase 3+). Returns null on
 * any failure rather than throwing, since background callers need to
 * degrade gracefully instead of propagating an error.
 */
export async function refreshAppliveryTokens(lastAccessToken: string, refreshToken: string): Promise<RefreshResult | null> {
  let res;
  try {
    res = await appliveryClient.post<any>("/auth/refresh", { lastAccessToken, refreshToken });
  } catch {
    return null;
  }
  const data = res.data ?? {};
  if (res.status !== 200 || !data.status) return null;
  const d = data.data ?? {};
  const access = d.accessToken ?? {};
  const refresh = d.refreshToken ?? {};
  if (!access.token) return null;
  return {
    appliveryAccessToken: access.token,
    appliveryAccessTokenExpireAt: access.expireAt,
    appliveryRefreshToken: refresh.token || refreshToken,
    appliveryRefreshTokenExpireAt: refresh.expireAt,
  };
}
