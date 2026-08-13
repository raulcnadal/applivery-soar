<script setup lang="ts">
// Fleet-wide "what's actually installed, where, at which version" table —
// the troubleshooting surface the Apps view was built for. Reads
// GET /api/app-lists/reported-apps (installedApps.service.ts's
// getReportedAppsOverview), which aggregates every device's
// InstalledAppInventory row regardless of whether any Compliance Policy
// references it — independent of App List/App Catalog authoring, this is
// purely "what does SOAR currently see".
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type ReportedAppSummary } from "../../stores/compliance";

const store = useComplianceStore();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS/iPadOS", macos: "macOS", android: "Android", windows: "Windows" };
const platformOptions = [
  { value: "", label: "All platforms" },
  { value: "apple", label: "iOS/iPadOS" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];

const filterPlatform = ref("");
const searchQuery = ref("");
const expandedKey = ref<string | null>(null);
const isRefreshing = ref(false);

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return store.reportedApps.filter((app) => {
    if (filterPlatform.value && app.platform !== filterPlatform.value) return false;
    if (!q) return true;
    return app.name.toLowerCase().includes(q) || app.identifier.toLowerCase().includes(q);
  });
});

function appKey(app: ReportedAppSummary): string {
  return `${app.platform}:${app.identifier}`;
}
function toggleExpanded(app: ReportedAppSummary) {
  const key = appKey(app);
  expandedKey.value = expandedKey.value === key ? null : key;
}
function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

async function refresh() {
  isRefreshing.value = true;
  try {
    await store.fetchReportedApps();
  } finally {
    isRefreshing.value = false;
  }
}

onMounted(() => {
  store.fetchReportedApps();
});
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <p class="text-xs text-gray-400">
        {{ store.reportedApps.length }} app{{ store.reportedApps.length === 1 ? "" : "s" }} seen across {{ store.reportedAppsDevicesWithData }} device{{ store.reportedAppsDevicesWithData === 1 ? "" : "s" }} with data
        <template v-if="store.reportedAppsLastRefreshedAt"> · newest report {{ formatAge(store.reportedAppsLastRefreshedAt) }}</template>
      </p>
      <Button size="sm" variant="secondary" :loading="isRefreshing" @click="refresh">
        <component :is="ICONS.Refresh" :size="11" weight="Linear" :class="isRefreshing ? 'animate-spin' : ''" /> Refresh
      </Button>
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      <select
        v-model="filterPlatform"
        class="px-2.5 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
      >
        <option v-for="p in platformOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
      <Input v-model="searchQuery" placeholder="Search app name or identifier…" class="flex-1 min-w-[200px]" />
    </div>

    <Alert v-if="store.reportedAppsError" type="danger">{{ store.reportedAppsError }}</Alert>
    <p v-else-if="store.isLoadingReportedApps && store.reportedApps.length === 0" class="text-xs text-gray-400">Loading…</p>
    <Alert v-else-if="!store.isLoadingReportedApps && store.reportedApps.length === 0" type="info">
      No app inventory data yet — devices report their installed apps via the SOAR Agent (App Inventory Reporting) or the background installed-apps refresher once a Compliance Policy references an App List.
    </Alert>

    <div v-else class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
      <p v-if="filtered.length === 0" class="text-xs text-gray-400 px-3 py-3">No apps match "{{ searchQuery }}".</p>
      <div v-for="app in filtered" :key="appKey(app)">
        <button type="button" class="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-900/40" @click="toggleExpanded(app)">
          <div class="min-w-0">
            <p class="text-sm text-gray-900 dark:text-white truncate">{{ app.name }}</p>
            <p class="text-[11px] text-gray-400 truncate">{{ PLATFORM_LABELS[app.platform] || app.platform }} · {{ app.identifier }}</p>
          </div>
          <div class="flex items-center gap-3 shrink-0 text-right">
            <div>
              <p class="text-xs font-semibold text-gray-900 dark:text-white">{{ app.deviceCount }} device{{ app.deviceCount === 1 ? "" : "s" }}</p>
              <p class="text-[10px] text-gray-400">{{ app.versions.length }} version{{ app.versions.length === 1 ? "" : "s" }} seen</p>
            </div>
            <component :is="expandedKey === appKey(app) ? ICONS.AltArrowUp : ICONS.AltArrowDown" :size="14" weight="Linear" class="text-gray-400" />
          </div>
        </button>
        <div v-if="expandedKey === appKey(app)" class="px-3 pb-3 -mt-1">
          <div class="border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
            <div v-for="d in app.devices" :key="d.deviceId" class="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
              <span class="text-gray-900 dark:text-white truncate">{{ d.deviceName }}</span>
              <span class="flex items-center gap-2 shrink-0 text-gray-400">
                <span class="font-mono">{{ d.version || "—" }}</span>
                <span
                  class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
                  :class="d.source === 'self_reported' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
                >
                  {{ d.source === "self_reported" ? "self-reported" : "MDM" }}
                </span>
                <span>{{ formatAge(d.fetchedAt) }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
