import axios from "axios";
import { useAuthStore } from "../stores/auth";

/**
 * Calls to this app's own backend. A request interceptor stamps the
 * dashboard JWT onto every request automatically (ARCHITECTURE.md §1.3 —
 * "components never attach it manually"), matching the original app's
 * axios interceptor pattern.
 */
export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.dashboardToken) {
    config.headers["X-Dashboard-Token"] = auth.dashboardToken;
  }
  // Only default this from the session — NOT overwrite it — so callers can
  // explicitly pin `X-Workspace-Slug: 'global'` for /api/state and
  // /api/layout, exactly like the original frontend's own hardcoded header
  // override on those two endpoints (see dashboardState.controller.ts's
  // module doc: that pair is deliberately shared across every workspace,
  // not scoped to whichever org is currently selected).
  if (auth.orgSlug && !config.headers["X-Workspace-Slug"]) {
    config.headers["X-Workspace-Slug"] = auth.orgSlug;
  }
  if (auth.apiToken) {
    config.headers["Authorization"] = `Bearer ${auth.apiToken}`;
  }
  return config;
});

// A 401 from this app's own backend only forces a full logout if the error
// message specifically indicates an invalid/missing dashboard session —
// other 401s (e.g. a data-level permission error) are left alone rather
// than logging the user out (ARCHITECTURE.md §1.3).
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401) {
      const detail = JSON.stringify(error.response.data ?? "");
      const auth = useAuthStore();

      // Specifically "the forwarded Applivery access token is stale"
      // (rbac.service.ts's findSelfCollaborator, or any other endpoint
      // forwarding it) — try one silent refresh + retry before treating
      // this as a real session failure, 1:1 with the original app's
      // direct-to-Applivery 401 handling (wow-dashboard/src/App.jsx's axios
      // response interceptor, ~163-186). Most of the time
      // useSessionGuards.ts's proactive refresh loop already renews the
      // token before it expires, so this is the fallback for whatever that
      // loop's 60s polling window ever misses (e.g. a backgrounded tab
      // whose timers got throttled).
      if (/Applivery session expired/i.test(detail) && !error.config?._appliveryRetried) {
        const ok = await auth.refreshAppliverySession();
        if (ok && error.config) {
          error.config._appliveryRetried = true;
          error.config.headers = error.config.headers ?? {};
          error.config.headers["Authorization"] = `Bearer ${auth.apiToken}`;
          return api(error.config);
        }
      }

      if (/dashboard|session/i.test(detail)) {
        auth.clearSession();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);
