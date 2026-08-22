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

// localStorage key for the wall-clock idle-timeout backstop below -- see
// resetIdleTimer's doc comment for why a plain setTimeout alone isn't
// enough. Written on every activity event (throttled) and read back
// whenever the page regains visibility, so it survives exactly the kind of
// full page/JS teardown a setTimeout can't.
const LAST_ACTIVITY_STORAGE_KEY = "soar:lastActivityAt";
const LAST_ACTIVITY_WRITE_THROTTLE_MS = 5000;

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
 *      keyboard/scroll activity, backed by a wall-clock timestamp in
 *      localStorage that's re-checked on every visibility/pageshow resume
 *      (see the idle-timeout section below for why the timer alone isn't
 *      enough on a mobile PWA/webclip); if either check concludes real idle
 *      time has exceeded `sessionTimeoutMinutes`, signs the user out. This
 *      is the literal enforcement of the configurable setting -- there was
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
  //
  // A plain setTimeout counting down in memory is enough on a desktop
  // browser tab, which keeps running JS in the background indefinitely --
  // but it silently stops enforcing anything at all once this app is added
  // to a mobile home screen as a PWA/webclip. iOS (and, less aggressively,
  // Android) fully suspends or outright discards a backgrounded PWA's JS
  // execution, including any pending setTimeout; reopening it later can
  // resume the exact same in-memory JS state (timer just never fired, no
  // way to tell how long it's actually been) or, just as often, cold-starts
  // the page from scratch (this composable re-mounts, calling
  // resetIdleTimer() fresh with zero memory of the elapsed real time) --
  // either way, a session left idle for hours comes back with no
  // re-authentication prompt at all. Desktop browsers don't hit this
  // because they don't suspend/discard background tabs the same way.
  //
  // The fix: track the *real* last-activity timestamp (wall-clock, not a
  // countdown) in localStorage rather than relying on the timer having
  // stayed alive. Every activity event refreshes it (throttled, since
  // mousemove/scroll fire far more often than a write is worth); the
  // in-memory setTimeout below still exists for the common case (an
  // actively-open tab, no suspension), but on top of it, `checkIdleElapsed`
  // re-derives "has the configured window actually elapsed?" from that
  // stored timestamp every time the page regains visibility (covers both
  // suspend-and-resume and a full cold reload) and on the recurring token
  // check tick, and logs out immediately if so -- instead of trusting a
  // timer that may never have been running to notice.
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastActivityWriteAt = 0;

  function currentTimeoutMs() {
    const minutes = dashboardStateStore.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES;
    return minutes * 60 * 1000;
  }

  function readLastActivityAt(): number {
    const raw = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function writeLastActivityAt(now: number, force = false) {
    if (!force && now - lastActivityWriteAt < LAST_ACTIVITY_WRITE_THROTTLE_MS) return;
    lastActivityWriteAt = now;
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
  }

  // Re-derives idle state from the stored wall-clock timestamp rather than
  // trusting the in-memory timer -- called whenever the page regains
  // visibility/focus (the moment a suspended/backgrounded PWA resumes) and
  // from the existing token-refresh tick as a periodic backstop while the
  // app stays foregrounded. Logs out immediately if real elapsed time
  // already exceeds the configured threshold; otherwise just resyncs the
  // in-memory timer to the *remaining* time rather than a full fresh
  // window, so returning right at the edge of the limit doesn't grant a
  // brand new full allowance.
  function checkIdleElapsed() {
    const elapsed = Date.now() - readLastActivityAt();
    if (elapsed >= currentTimeoutMs()) {
      logout();
      return;
    }
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(logout, currentTimeoutMs() - elapsed);
  }

  function resetIdleTimer() {
    const now = Date.now();
    writeLastActivityAt(now, true);
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(logout, currentTimeoutMs());
  }

  function handleActivityEvent() {
    writeLastActivityAt(Date.now());
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(logout, currentTimeoutMs());
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") checkIdleElapsed();
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
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, handleActivityEvent);
    window.addEventListener("visibilitychange", handleVisibilityChange);
    // pageshow fires on bfcache restores that some WebKit versions don't
    // reliably pair with a visibilitychange event -- belt and suspenders
    // for the same "resumed after being suspended" moment.
    window.addEventListener("pageshow", checkIdleElapsed);
    // Deliberately checkIdleElapsed(), not resetIdleTimer(), on mount: this
    // composable re-mounting is itself the "cold reload after the OS
    // discarded a suspended PWA" scenario this fix targets, and the stored
    // timestamp is from BEFORE this reload. Calling resetIdleTimer() here
    // would silently wipe that stale timestamp and hand out a brand new
    // full session -- exactly the bug being fixed. checkIdleElapsed() reads
    // the real elapsed time first and only lets the session continue
    // (synced to whatever time actually remains) if it hasn't already
    // expired.
    checkIdleElapsed();
    refreshIntervalId = setInterval(() => {
      checkIdleElapsed();
      checkTokenExpiry();
    }, TOKEN_REFRESH_CHECK_INTERVAL_MS);
  });

  // Re-arm the idle timer whenever the configured threshold changes (e.g.
  // Settings > General is saved while this session is still open, or
  // dashboardState finishes loading the real persisted value after this
  // composable's own mount already started a timer against the fallback
  // default above) -- matches the original effect's dependency array
  // re-subscribing whenever sessionTimeoutMinutes changed. A genuine full
  // reset (not just a re-check) is correct here -- the threshold itself
  // changed, not just time passing.
  watch(
    () => dashboardStateStore.sessionTimeoutMinutes,
    () => resetIdleTimer(),
  );

  onUnmounted(() => {
    clearTimeout(idleTimeoutId);
    clearInterval(refreshIntervalId);
    for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, handleActivityEvent);
    window.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", checkIdleElapsed);
  });
}
