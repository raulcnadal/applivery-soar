import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

/**
 * Replaces App.jsx's `currentView` useState switch (ARCHITECTURE.md §1.4)
 * with real Vue Router routes.
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
    { path: "/access-denied", name: "access-denied", component: () => import("../views/AccessDeniedView.vue") },
    { path: "/", name: "overview", component: () => import("../views/OverviewView.vue") },
    { path: "/playground", name: "playground", component: () => import("../views/PlaygroundView.vue") },
    { path: "/devices", name: "devices", component: () => import("../views/DevicesView.vue") },
    { path: "/compliance", name: "compliance", component: () => import("../views/ComplianceView.vue") },
    { path: "/workflows", name: "workflows", component: () => import("../views/WorkflowsView.vue") },
    { path: "/cases", name: "cases", component: () => import("../views/CasesView.vue") },
    { path: "/reporting", name: "reporting", component: () => import("../views/ReportingView.vue") },
    { path: "/audit-logs", name: "audit-logs", component: () => import("../views/AuditLogsView.vue") },
  ],
});

// RBAC gate — 1:1 in spirit with App.jsx's App()'s boot-time `gateAccess`
// (~line 6688): the original re-resolves POST /api/auth/resolve-access on
// EVERY app boot (any page load with a persisted session, not just a fresh
// login) and refuses to render anything but AccessDeniedScreen until it
// comes back allowed:true. This port had resolveAccess() itself and the
// per-tab/per-button hasFeatureAccess() checks, but nothing that actually
// re-ran resolveAccess() on a plain page load/hard-refresh, and nothing
// that blocked navigation on a denied result — auth.access just stayed
// whatever was last resolved in memory (null after a fresh page load,
// Pinia state isn't persisted), so hasFeatureAccess() silently returned
// false for everyone including a real Owner (hiding every gated nav tab
// until the next login/workspace-switch), AND a signed-in-but-unmapped
// account could freely reach the Overview route — which carries no `area`
// in AppShell.vue's NAV_TABS since it's the landing page — with no warning
// at all. This guard restores both: re-resolve once per in-memory session
// if missing, then hard-redirect to /access-denied whenever the resolved
// access is allowed:false, exactly like the original's full-screen block.
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.name === "login") return true;
  if (!auth.isAuthenticated) return { name: "login" };

  if (auth.access === null) {
    try {
      await auth.resolveAccess();
    } catch {
      // Resolution itself failed (network/auth error) — fail closed, same
      // as the original's catch block turning this into a denied state
      // rather than silently letting the user through.
      return to.name === "access-denied" ? true : { name: "access-denied" };
    }
  }

  if (!auth.access?.allowed) {
    return to.name === "access-denied" ? true : { name: "access-denied" };
  }
  if (to.name === "access-denied") return { name: "overview" };
  return true;
});

export default router;
