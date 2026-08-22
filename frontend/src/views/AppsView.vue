<script setup lang="ts">
// Apps — new top-level view (nav tab added in AppShell.vue). Three purposes:
// 1) Reported Apps: fleet-wide visibility into what SOAR currently sees
//    installed, on which devices, at which version — a troubleshooting aid
//    independent of Compliance enforcement (see ReportedAppsPanel.vue).
// 2) App Catalog: the shared identifier catalog App Lists build from —
//    moved here from AppListsPanel.vue's old left column so that panel
//    doesn't keep growing more crowded as more apps get cataloged.
// 3) App Lists: grouping App Catalog entries into named lists a Compliance
//    Policy can reference (requiredAppList/disallowedAppList conditions).
//    Moved here from Compliance's own sub-view switcher per user request —
//    it's fundamentally about apps, not policies, and Compliance now has
//    only one sub-view (Policies) left once this moves, so that switcher
//    was removed there too.
import { ref } from "vue";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import ReportedAppsPanel from "../components/apps/ReportedAppsPanel.vue";
import AppCatalogPanel from "../components/apps/AppCatalogPanel.vue";
import AppListsPanel from "../components/compliance/AppListsPanel.vue";

const subView = ref<"reported" | "catalog" | "lists">("reported");
</script>

<template>
  <main class="p-4 md:p-8 pb-16">
    <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900 dark:text-white">Apps</h1>
          <HelpIcon slug="apps" title="Apps admin guide" />
        </div>
        <p class="text-sm mt-1 text-gray-400">What's actually installed across the fleet, and the shared catalog Compliance App Lists are built from.</p>
      </div>
      <div class="flex items-center gap-1 p-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 shrink-0">
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
          :class="subView === 'reported' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
          @click="subView = 'reported'"
        >
          <component :is="ICONS.Gauge" :size="14" weight="Linear" /> Reported Apps
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
          :class="subView === 'catalog' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
          @click="subView = 'catalog'"
        >
          <component :is="ICONS.Checklist" :size="14" weight="Linear" /> Custom Catalog
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
          :class="subView === 'lists' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
          @click="subView = 'lists'"
        >
          <component :is="ICONS.ShieldWarning" :size="14" weight="Linear" /> App Lists
        </button>
      </div>
    </header>

    <ReportedAppsPanel v-if="subView === 'reported'" />
    <AppCatalogPanel v-else-if="subView === 'catalog'" />
    <AppListsPanel v-else />
  </main>
</template>
