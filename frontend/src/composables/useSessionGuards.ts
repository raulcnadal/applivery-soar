import { onMounted, onUnmounted, watch } from "vue";
import { useAuthStore } from "../stores/auth";
import { useDashboardStateStore } from "../stores/dashboardState";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll"] as const;
// Matches _clamp_session_timeout's SESSION_TIMEOUT_DEFAULT_MINUTES in the
// original main.py -- used only until dashboardState's fetchState() resolves
// (sessionTimeoutMinutes is null until then) or for a workspace that has
// never explicitly set the value.
const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;
const TOKEN_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;
const TOKEN_REFRESH_LEAD_MS = 60 * 1000;

/**
 * 1:1 port of App.jsx's two session-keepalive effects (wow-dashboard/src/
 * App.jsx ~2828-2891) -- missing entirely from the initial Vue port. Without
 * them, the "Idle Session Timeout" setting (Settings > General) did nothing
 * at all, and the Applivery access token (much shorter-lived than this
 * app's own 30-day dashboard JWT, see stores/auth.ts's module doc) simply
 * expired on its own natural schedule with nothing renewing it -- which is
 * what a user idle for over an hour actually experienced, regardless of
 * whatever value they'd set the configurable timeout to.
 *
 * Two independent concerns, both active only while signed in -- call this
 * from AppShell.vue, which only ever renders for an authenticated,
 * non-standalone route (see App.vue's isStandalone computed):
 *
 *   1. Idle-timeout watcher -- resets a plain setTimeout on any mouse/
 *      keyboard/scroll activity; if it ever actually fires (no activity for
 *      `sessionTimeoutMinutes` minutes), signs the user out. This is the
 *      literal enforcement of the configurable setting -- there was
 *      previously nothing reading that setting at all.
 *   2. Proactive token refresh -- independent of user activity: every 60s,
 *      checks whether the Applivery access token is within 60s of its own
 *      expiry, and if so calls POST /api/auth/refresh (via
 *      auth.refreshAppliverySession()) to renew it before it actually
 *      expires. This is what makes an *active* user's session effectively
 *      never expire on its own (matching the original's design) -- only
 *      genuine inactivity past the configured threshold above should ever
 *      sign someone out.
 */
export function useSessionGuards() {
  const auth = useAuthStore();
  const dashboardStateStore = useDashboardStateStore();

  function logout() {
    auth.clearSession();
    window.location.href = "/login";
  }

  // ── 1. Idle-timeout watcher ──
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
  function resetIdleTimer() {
    clearTimeout(idleTimeoutId);
    const minutes = dashboardStateStore.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES;
    idleTimeoutId = setTimeout(logout, minutes * 60 * 1000);
  }

  // ── 2. Proactive Applivery token refresh ──
  let refreshIntervalId: ReturnType<typeof setInterval> | undefined;
  async function checkTokenExpiry() {
    if (!auth.apiTokenExpireAt) return;
    const expiringSoon = new Date(auth.apiTokenExpireAt).getTime() - Date.now() < TOKEN_REFRESH_LEAD_MS;
    if (!expiringSoon) return;
    const ok = await auth.refreshAppliverySession();
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error("Applivery session could not be renewed — signing out.");
      logout();
    }
  }

  onMounted(() => {
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, resetIdleTimer);
    resetIdleTimer();
    refreshIntervalId = setInterval(checkTokenExpiry, TOKEN_REFRESH_CHECK_INTERVAL_MS);
  });

  // Re-arm the idle timer whenever the configured threshold changes (e.g.
  // Settings > General is saved while this session is still open, or
  // dashboardState finishes loading the real persisted value after this
  // composable's own mount already started a timer against the fallback
  // default above) -- matches the original effect's dependency array
  // re-subscribing whenever sessionTimeoutMinutes changed.
  watch(
    () => dashboardStateStore.sessionTimeoutMinutes,
    () => resetIdleTimer(),
  );

  onUnmounted(() => {
    clearTimeout(idleTimeoutId);
    clearInterval(refreshIntervalId);
    for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, resetIdleTimer);
  });
}
