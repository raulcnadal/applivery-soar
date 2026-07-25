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
  if (auth.orgSlug) {
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
  (error) => {
    if (error?.response?.status === 401) {
      const detail = JSON.stringify(error.response.data ?? "");
      if (/dashboard|session/i.test(detail)) {
        const auth = useAuthStore();
        auth.clearSession();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);
