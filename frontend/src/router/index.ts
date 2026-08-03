import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

/**
 * Replaces App.jsx's `currentView` useState switch (ARCHITECTURE.md §1.4)
 * with real Vue Router routes. RBAC-based route filtering (mirroring
 * hasFeatureAccess) is added in Phase 1 once resolve-access is wired up;
 * for now this only gates on "is a dashboard session present at all".
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
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

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.name !== "login" && !auth.isAuthenticated) {
    return { name: "login" };
  }
  return true;
});

export default router;
