<script setup lang="ts">
// Minimal navigation shell wrapping every authenticated route — the
// original app's top nav (ARCHITECTURE.md §1.4) becomes real Vue Router
// links here instead of a `currentView` state switch. Grows one item per
// phase as each top-level view is ported (Overview done in Phase 0,
// Devices in Phase 2; Compliance/Workflows/Cases/Audit Logs/Settings
// follow in Phases 3, 4, 5, 6).
import { VerticalNav } from "@applivery/bluesky-vue";
import { computed } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const navItems = [
  { id: "overview", label: "Overview" },
  { id: "devices", label: "Devices" },
  { id: "compliance", label: "Compliance" },
];

const activeId = computed(() => (typeof route.name === "string" ? route.name : "overview"));

function onNavigate(id: string) {
  router.push({ name: id });
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
  </div>
</template>
