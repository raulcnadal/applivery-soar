<script setup lang="ts">
// Minimal navigation shell wrapping every authenticated route — the
// original app's top nav (ARCHITECTURE.md §1.4) becomes real Vue Router
// links here instead of a `currentView` state switch. Grows one item per
// phase as each top-level view is ported (Overview done in Phase 0,
// Devices in Phase 2; Compliance/Workflows/Cases/Audit Logs/Settings
// follow in Phases 3, 4, 5, 6).
import { VerticalNav } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { api } from "../api/http";
import WorkspaceOnboardingModal from "../components/onboarding/WorkspaceOnboardingModal.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// New-workspace onboarding (main.py:1802-1811's workspace-status check) —
// checked once per landing (fresh login, or after a workspace switch's full
// reload — both are a fresh AppShell mount, so a single mount-time effect
// covers both). Only offered once per still-empty workspace per browser;
// dismissing it sets a per-workspace localStorage flag (see
// WorkspaceOnboardingModal.vue's dismissForThisWorkspace).
const isOnboardingModalOpen = ref(false);
onMounted(async () => {
  if (!auth.orgSlug) return;
  try {
    if (localStorage.getItem(`applivery_onboarding_dismissed_${auth.orgSlug}`) === "1") return;
  } catch {
    /* ignore */
  }
  try {
    const res = await api.get("/config/workspace-status");
    if (res.data?.isEmpty) isOnboardingModalOpen.value = true;
  } catch {
    // non-critical — just skip onboarding if the check fails
  }
});

const navItems = [
  { id: "overview", label: "Overview" },
  { id: "playground", label: "Playground" },
  { id: "devices", label: "Devices" },
  { id: "compliance", label: "Compliance" },
  { id: "workflows", label: "Workflows" },
  { id: "cases", label: "Cases" },
  { id: "reporting", label: "Reporting" },
  { id: "audit-logs", label: "Audit Logs" },
  { id: "settings", label: "Settings" },
];

const activeId = computed(() => (typeof route.name === "string" ? route.name : "overview"));

function onNavigate(id: string) {
  router.push({ name: id });
}

// Same reasoning as handleSwitchOrganization elsewhere — a full reload after
// a config clone is the simplest way to guarantee every store re-fetches
// against the now-populated workspace. Kept as a named method (rather than
// an inline template arrow function referencing `window`) since vue-tsc's
// template type-checker doesn't resolve globals inside template
// expressions the way plain <script> code can.
function onCloned() {
  isOnboardingModalOpen.value = false;
  window.location.reload();
}
</script>

<template>
  <div class="min-h-screen flex bg-[var(--background,#f8fafc)]">
    <aside class="w-56 shrink-0 border-r border-gray-100 bg-white p-4">
      <p class="text-sm font-semibold text-brand-900 px-3 mb-6">Applivery SOAR</p>
      <VerticalNav :items="navItems" :model-value="activeId" @update:model-value="onNavigate" />
    </aside>
    <main class="flex-1 min-w-0">
      <RouterView />
    </main>
    <WorkspaceOnboardingModal
      v-if="isOnboardingModalOpen"
      @close="isOnboardingModalOpen = false"
      @cloned="onCloned"
    />
  </div>
</template>
