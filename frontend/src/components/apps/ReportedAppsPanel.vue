<script setup lang="ts">
// Fleet-wide "what's actually installed, where, at which version" table —
// the troubleshooting surface the Apps view was built for. Reads
// GET /api/app-lists/reported-apps (installedApps.service.ts's
// getReportedAppsOverview), which aggregates every device's
// InstalledAppInventory row regardless of whether any Compliance Policy
// references it — independent of App List/App Catalog authoring, this is
// purely "what does SOAR currently see". Clicking a row opens
// AppDetailModal.vue for the per-device breakdown, App List membership, and
// (Windows only) a best-effort Applivery application-catalog lookup.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type ReportedAppSummary } from "../../stores/compliance";
import AppDetailModal from "./AppDetailModal.vue";

const store = useComplianceStore();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS/iPadOS", macos: "macOS", android: "Android", windows: "Windows" };
const platformOptions = [
  { value: "", label: "All platforms" },
  { value: "apple", label: "iOS/iPadOS" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];
// entry.source values as written by installedApps.service.ts (fetchAndStoreInstalledApps
// = "server_fetch", reportDeviceApps/deviceData.service.ts = "self_reported").
const SOURCE_LABELS: Record<string, string> = { self_reported: "Self-reported", server_fetch: "Applivery UEM" };

const filterPlatform = ref("");
const searchQuery = ref("");
const isRefreshing = ref(false);
const selectedApp = ref<ReportedAppSummary | null>(null);

// Risk column — see docs/apps.md#vulnerability-service-risk-scoring for the
// scoring formula (vulnService.ts's rollUpAppSummary). "—" (no badge) covers
// both "Vulnerability Service isn't enabled for this workspace" and "enabled
// but no cached CVE match for any version of this app yet" — deliberately
// not distinguished here, same as the App detail modal's own Vulnerabilities
// section; Settings > Vulnerability Service is where that distinction lives.
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-600 dark:text-red-400 bg-red-500/10",
  HIGH: "text-orange-600 dark:text-orange-400 bg-orange-500/10",
  MEDIUM: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  LOW: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
};
function riskBadgeClass(app: ReportedAppSummary): string {
  const sev = app.vulnSummary?.maxSeverity;
  return sev ? SEVERITY_COLORS[sev] || "text-gray-500 bg-gray-500/10" : "";
}
function riskLabel(app: ReportedAppSummary): string {
  const summary = app.vulnSummary;
  if (!summary || summary.totalCveCount === 0) return "—";
  return `${summary.riskScore}`;
}

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
function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}
// Single version -> show it directly; multiple -> the version drift itself
// is the useful signal, shown as a count (open the detail modal for the
// per-device breakdown of which device has which).
function versionLabel(app: ReportedAppSummary): string {
  if (app.versions.length === 0) return "—";
  if (app.versions.length === 1) return app.versions[0];
  return `${app.versions.length} versions`;
}
function sourceLabel(app: ReportedAppSummary): string {
  if (app.sources.length === 0) return "—";
  if (app.sources.length === 1) return SOURCE_LABELS[app.sources[0]] || app.sources[0];
  return "Mixed";
}
// The first non-null fetch error among this app's devices — surfaced as a
// hover tooltip so "why does this only ever show self-reported data" is
// answerable without digging through backend logs (see
// ReportedAppDeviceRef.lastFetchError's doc comment, installedApps.service.ts).
function firstFetchError(app: ReportedAppSummary): string | null {
  return app.devices.find((d) => d.lastFetchError)?.lastFetchError ?? null;
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
  // The detail modal's "App Lists" section needs these — loaded here too
  // (not just AppCatalogPanel.vue's own onMounted) since an admin may open
  // Reported Apps without ever visiting the App Catalog sub-view first.
  if (!store.appCatalog.length) store.fetchAppCatalog();
  if (!store.appLists.length) store.fetchAppLists();
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

    <p class="text-[10px] text-gray-400 flex items-start gap-1">
      <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
      "Self-reported" comes from the SOAR Agent's App Inventory Reporting; "Applivery UEM" comes from Applivery's own device-management API. "Update available" is currently only reported by Applivery for iOS/iPadOS/macOS apps — it flags that an update exists but Applivery doesn't expose the target version number. "Risk" needs Settings &gt; Vulnerability Service enabled — shows "—" otherwise, or when no CVE match is cached yet for any reported version. Click a row for per-device detail, App List membership, per-version CVE breakdown, and (Windows) a lookup against Applivery's own application library.
    </p>

    <Alert v-if="store.reportedAppsError" type="danger">{{ store.reportedAppsError }}</Alert>
    <p v-else-if="store.isLoadingReportedApps && store.reportedApps.length === 0" class="text-xs text-gray-400">Loading…</p>
    <Alert v-else-if="!store.isLoadingReportedApps && store.reportedApps.length === 0" type="info">
      No app inventory data yet — devices report their installed apps via the SOAR Agent (App Inventory Reporting) or the background installed-apps refresher once a Compliance Policy references an App List.
    </Alert>

    <div v-else class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden">
      <div class="hidden sm:grid grid-cols-[1fr_140px_120px_120px_70px_90px_24px] gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-700">
        <span>App</span>
        <span>Version</span>
        <span>Source</span>
        <span>Update</span>
        <span>Risk</span>
        <span class="text-right">Devices</span>
        <span></span>
      </div>
      <p v-if="filtered.length === 0" class="text-xs text-gray-400 px-3 py-3">No apps match "{{ searchQuery }}".</p>
      <div class="divide-y divide-gray-100 dark:divide-gray-700">
        <button
          v-for="app in filtered"
          :key="appKey(app)"
          type="button"
          class="w-full grid grid-cols-2 sm:grid-cols-[1fr_140px_120px_120px_70px_90px_24px] gap-2 items-center px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-900/40"
          @click="selectedApp = app"
        >
          <div class="min-w-0 col-span-2 sm:col-span-1">
            <p class="text-sm text-gray-900 dark:text-white truncate flex items-center gap-1.5">
              {{ app.name }}
              <component
                v-if="firstFetchError(app)"
                :is="ICONS.DangerTriangle"
                :size="11"
                weight="Linear"
                class="text-amber-500 shrink-0"
                :title="`Last live fetch error: ${firstFetchError(app)}`"
              />
            </p>
            <p class="text-[11px] text-gray-400 truncate">{{ PLATFORM_LABELS[app.platform] || app.platform }} · {{ app.identifier }}</p>
          </div>
          <div class="text-xs text-gray-700 dark:text-gray-300 truncate" :title="app.versions.join(', ')">{{ versionLabel(app) }}</div>
          <div>
            <span
              class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
              :class="app.sources.includes('self_reported') && app.sources.length === 1 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : app.sources.length > 1 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
            >
              {{ sourceLabel(app) }}
            </span>
          </div>
          <div>
            <span v-if="app.devicesWithPendingUpdate > 0" class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 whitespace-nowrap">
              {{ app.devicesWithPendingUpdate }} pending
            </span>
            <span v-else class="text-xs text-gray-300 dark:text-gray-600">—</span>
          </div>
          <div>
            <span
              v-if="riskLabel(app) !== '—'"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
              :class="riskBadgeClass(app)"
              :title="app.vulnSummary?.hasKev ? 'Includes a known-exploited (CISA KEV) CVE' : `${app.vulnSummary?.totalCveCount} known CVE(s) across all reported versions`"
            >
              <component v-if="app.vulnSummary?.hasKev" :is="ICONS.DangerTriangle" :size="10" weight="Linear" />
              {{ riskLabel(app) }}
            </span>
            <span v-else class="text-xs text-gray-300 dark:text-gray-600">—</span>
          </div>
          <div class="text-right text-xs font-semibold text-gray-900 dark:text-white">{{ app.deviceCount }}</div>
          <component :is="ICONS.AltArrowRight" :size="14" weight="Linear" class="text-gray-400 justify-self-end" />
        </button>
      </div>
    </div>

    <AppDetailModal :open="!!selectedApp" :app="selectedApp" @close="selectedApp = null" />
  </div>
</template>
