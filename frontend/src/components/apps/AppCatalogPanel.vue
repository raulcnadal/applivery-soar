<script setup lang="ts">
// App Catalog manager — extracted from AppListsPanel.vue (previously the
// left column of Compliance > App Lists) into its own component so it can
// live on the new top-level "Apps" view instead, per the user's ask: App
// Lists inside Compliance was getting crowded as more apps get cataloged,
// and app-inventory troubleshooting deserves its own place to grow into
// (more apps features planned later). Compliance > App Lists still reads
// store.appCatalog directly (AppListsPanel.vue's list editor) — this
// component owns *managing* the catalog; anywhere else just references it.
//
// Layout: the catalog list ("Custom Catalog") is the naturally taller,
// content-heavy side, so it's the left/main column; the add-apps entry
// point is now just a button that opens AddAppsWizardModal.vue (previously
// an always-open multi-source search panel here, which made this view feel
// cluttered next to the catalog list it sits beside) — kept as the shorter
// right-hand column.
import { Button } from "@applivery/bluesky-vue";
import { onMounted, computed, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type AppCatalogEntry } from "../../stores/compliance";
import AddAppsWizardModal from "./AddAppsWizardModal.vue";

const store = useComplianceStore();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };
const platformOptions = [
  { value: "apple", label: "Apple (iOS/iPadOS)" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];

const filterPlatform = ref<string>("");
const isWizardOpen = ref(false);

const filteredCatalog = computed(() => (filterPlatform.value ? store.appCatalog.filter((e) => e.platform === filterPlatform.value) : store.appCatalog));

onMounted(async () => {
  await store.fetchAppCatalog();
  // Needed for the wizard's "From Reported Apps" source — ReportedAppsPanel.vue
  // also fetches this, but an admin may open App Catalog without ever
  // visiting Reported Apps first.
  if (!store.reportedApps.length) store.fetchReportedApps();
});

async function removeCatalogEntry(entry: AppCatalogEntry) {
  if (!confirm(`Remove "${entry.name || entry.identifier}" from the App Catalog?`)) return;
  try {
    await store.deleteAppCatalogEntry(entry.id);
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Could not remove — it may still be referenced by an App List.");
  }
}
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
    <section class="space-y-3 order-2 lg:order-1">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Custom Catalog ({{ filteredCatalog.length }})</p>
        <select
          v-model="filterPlatform"
          class="px-2 py-1 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All platforms</option>
          <option v-for="p in platformOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>
      <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700 max-h-[560px] overflow-y-auto">
        <div v-for="entry in filteredCatalog" :key="entry.id" class="flex items-center justify-between px-3 py-2 text-sm">
          <div>
            <p class="text-gray-900 dark:text-white">{{ entry.name || entry.identifier }}</p>
            <p class="text-xs text-gray-400">{{ PLATFORM_LABELS[entry.platform] || entry.platform }} · {{ entry.identifier }}</p>
          </div>
          <Button size="sm" variant="ghost" @click="removeCatalogEntry(entry)">Remove</Button>
        </div>
        <p v-if="filteredCatalog.length === 0" class="text-xs text-gray-400 px-3 py-3">No catalog entries yet — click "Add new Apps" to get started.</p>
      </div>
    </section>

    <section class="space-y-3 order-1 lg:order-2">
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Search &amp; add to catalog</p>
      <p class="text-xs text-gray-400">
        Add apps to the Custom Catalog from what SOAR has already seen installed across your fleet, or import from each platform's app store — App Lists (Compliance) are built from this catalog.
      </p>
      <Button size="sm" @click="isWizardOpen = true">
        <component :is="ICONS.AddSquare" :size="14" weight="Linear" /> Add new Apps
      </Button>
    </section>

    <AddAppsWizardModal :open="isWizardOpen" @close="isWizardOpen = false" />
  </div>
</template>
