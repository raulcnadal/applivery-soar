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
import { useComplianceStore, type ReportedAppDeviceRef, type ReportedAppSummary } from "../../stores/compliance";
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

// ── Column sort — Version/Source/Update/Risk, click a header to sort,
// click again to reverse, a third click clears back to the default
// (deviceCount desc, same as getReportedAppsOverview's own server-side
// order) ordering.
type SortKey = "version" | "source" | "update" | "risk";
const sortBy = ref<SortKey | null>(null);
const sortDir = ref<"asc" | "desc">("desc");
const DEFAULT_SORT_DIR: Record<SortKey, "asc" | "desc"> = { version: "asc", source: "asc", update: "desc", risk: "desc" };

function versionCompare(a: string, b: string): number {
  const toParts = (v: string) => v.split(/[.\s]+/).map((s) => parseInt(s, 10));
  const pa = toParts(a);
  const pb = toParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = Number.isNaN(pa[i]) ? 0 : pa[i] ?? 0;
    const bv = Number.isNaN(pb[i]) ? 0 : pb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function toggleSort(key: SortKey) {
  if (sortBy.value !== key) {
    sortBy.value = key;
    sortDir.value = DEFAULT_SORT_DIR[key];
  } else if (sortDir.value === DEFAULT_SORT_DIR[key]) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortBy.value = null;
  }
}

const sorted = computed(() => {
  if (!sortBy.value) return filtered.value;
  const key = sortBy.value;
  const dir = sortDir.value === "asc" ? 1 : -1;
  const copy = [...filtered.value];
  copy.sort((a, b) => {
    switch (key) {
      case "version": {
        // A single-version app sorts by its actual version number; an app
        // with drifted versions across the fleet sorts by how many
        // distinct versions it has (the signal the "N versions" label
        // itself is showing) — the two aren't directly comparable, so
        // version-count takes priority whenever either side has more than
        // one, falling back to a real version compare only when both sides
        // are single-version.
        if (a.versions.length > 1 || b.versions.length > 1) return dir * (a.versions.length - b.versions.length);
        return dir * versionCompare(a.versions[0] || "", b.versions[0] || "");
      }
      case "source":
        return dir * sourceLabel(a).localeCompare(sourceLabel(b));
      case "update":
        return dir * (a.devicesWithPendingUpdate - b.devicesWithPendingUpdate);
      case "risk": {
        const ra = a.vulnSummary && a.vulnSummary.totalCveCount > 0 ? a.vulnSummary.riskScore : -1;
        const rb = b.vulnSummary && b.vulnSummary.totalCveCount > 0 ? b.vulnSummary.riskScore : -1;
        return dir * (ra - rb);
      }
      default:
        return 0;
    }
  });
  return copy;
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
// Type — the package format, derived from the per-device origin values
// (Windows-only data; every other platform has no format signal today).
// Winget-detected and registry-fallback-detected Win32 apps are the same
// *format* (a classic installer) — the winget/registry distinction is a
// question of "how do we know", which is what the Source column (below)
// answers, not Type.
function typeLabel(app: ReportedAppSummary): string {
  if (app.platform === "windows") {
    const origins = app.devices.map((d) => d.origin).filter((o): o is NonNullable<typeof o> => Boolean(o));
    if (origins.length === 0) return "—";
    const hasStore = origins.some((o) => o === "store");
    const hasInstaller = origins.some((o) => o === "msi" || o === "winget");
    if (hasStore && hasInstaller) return "Mixed";
    return hasStore ? "APPX" : "MSI";
  }
  if (app.platform === "apple" || app.platform === "macos") return "IPA";
  if (app.platform === "android" || app.platform === "aosp") return "APK";
  return "—";
}
// Source — how the app got onto the device, distinct from "Reported by"
// (who told SOAR about it). "UEM" wins over origin when Applivery's own
// Windows App Distribution policy has this app assigned/enforced on the
// device (deviceWinPolicy.applicationsInfo) — that's a stronger signal than
// how the agent happened to detect it. "Winget" requires an agent build new
// enough to tag it distinctly from a plain registry-fallback detection (see
// apps_windows.go's getAppsViaWinget/getAppsViaRegistry) — an older agent's
// self-reports fall back to "Manual" here until that device's agent is
// updated, same as any other origin-derived field.
const ACQUISITION_SOURCE_LABELS: Record<string, string> = { store: "MS Store", winget: "Winget" };
function acquisitionSource(d: ReportedAppDeviceRef): string {
  if (d.enforcedByPolicy) return "UEM";
  return ACQUISITION_SOURCE_LABELS[d.origin ?? ""] ?? "Manual";
}
function acquisitionSourceLabel(app: ReportedAppSummary): string {
  // Windows-only — the underlying origin/enforcedByPolicy data doesn't
  // exist for other platforms yet.
  if (app.platform !== "windows") return "—";
  const values = new Set(app.devices.map(acquisitionSource));
  if (values.size === 0) return "—";
  if (values.size > 1) return "Mixed";
  return [...values][0];
}
const ACQUISITION_BADGE_CLASS: Record<string, string> = {
  UEM: "bg-brand-500/10 text-brand-600 dark:text-brand-400",
  "MS Store": "bg-violet-500/10 text-violet-500",
  Winget: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Manual: "bg-gray-500/10 text-gray-500 dark:text-gray-400",
  Mixed: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};
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
      "Reported by" is who told SOAR about this app — "Self-reported" from the SOAR Agent's App Inventory Reporting, "Applivery UEM" from Applivery's own device-management API. "Source" is how the app got onto the device (Windows only) — "UEM" when Applivery's own Windows App Distribution has it assigned/enforced, "MS Store" for AppX/UWP packages, "Winget" for an app the SOAR Agent detected via `winget list`, "Manual" otherwise (also covers a self-reporting agent build older than the winget/registry split). "Update available" is currently only reported by Applivery for iOS/iPadOS/macOS apps — it flags that an update exists but Applivery doesn't expose the target version number. "Risk" needs Settings &gt; Vulnerability Service enabled — shows "—" otherwise, or when no CVE match is cached yet for any reported version. Click a row for per-device detail, App List membership, per-version CVE breakdown, and (Windows) a lookup against Applivery's own application library.
    </p>

    <Alert v-if="store.reportedAppsError" type="danger">{{ store.reportedAppsError }}</Alert>
    <p v-else-if="store.isLoadingReportedApps && store.reportedApps.length === 0" class="text-xs text-gray-400">Loading…</p>
    <Alert v-else-if="!store.isLoadingReportedApps && store.reportedApps.length === 0" type="info">
      No app inventory data yet — devices report their installed apps via the SOAR Agent (App Inventory Reporting) or the background installed-apps refresher once a Compliance Policy references an App List.
    </Alert>

    <div v-else class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden overflow-x-auto">
      <div class="hidden sm:grid grid-cols-[1fr_90px_60px_110px_100px_90px_70px_70px_24px] gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-700 min-w-[900px]">
        <span>App</span>
        <button
          v-for="col in [
            { key: 'version', label: 'Version' },
          ]"
          :key="col.key"
          type="button"
          class="inline-flex items-center gap-1 uppercase tracking-wider text-left"
          :style="{ color: sortBy === col.key ? '#0241E3' : undefined }"
          @click.stop="toggleSort(col.key as SortKey)"
        >
          {{ col.label }} <component :is="ICONS.SortVertical" :size="10" weight="Linear" />
        </button>
        <span title="Package format — MSI, APPX, etc.">Type</span>
        <button
          type="button"
          class="inline-flex items-center gap-1 uppercase tracking-wider text-left"
          :style="{ color: sortBy === 'source' ? '#0241E3' : undefined }"
          title="Who told SOAR about this app"
          @click.stop="toggleSort('source')"
        >
          Reported by <component :is="ICONS.SortVertical" :size="10" weight="Linear" />
        </button>
        <span title="How the app got onto the device — Windows only">Source</span>
        <button
          v-for="col in [
            { key: 'update', label: 'Update' },
            { key: 'risk', label: 'Risk' },
          ]"
          :key="col.key"
          type="button"
          class="inline-flex items-center gap-1 uppercase tracking-wider text-left"
          :style="{ color: sortBy === col.key ? '#0241E3' : undefined }"
          @click.stop="toggleSort(col.key as SortKey)"
        >
          {{ col.label }} <component :is="ICONS.SortVertical" :size="10" weight="Linear" />
        </button>
        <span class="text-right">Devices</span>
        <span></span>
      </div>
      <p v-if="filtered.length === 0" class="text-xs text-gray-400 px-3 py-3">No apps match "{{ searchQuery }}".</p>
      <div class="divide-y divide-gray-100 dark:divide-gray-700">
        <button
          v-for="app in sorted"
          :key="appKey(app)"
          type="button"
          class="w-full grid grid-cols-2 sm:grid-cols-[1fr_90px_60px_110px_100px_90px_70px_70px_24px] gap-2 items-center px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-900/40 sm:min-w-[900px]"
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
          <div class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{{ typeLabel(app) }}</div>
          <div>
            <span
              class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
              :class="app.sources.includes('self_reported') && app.sources.length === 1 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : app.sources.length > 1 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
            >
              {{ sourceLabel(app) }}
            </span>
          </div>
          <div>
            <span
              v-if="acquisitionSourceLabel(app) !== '—'"
              class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
              :class="ACQUISITION_BADGE_CLASS[acquisitionSourceLabel(app)] || 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
            >
              {{ acquisitionSourceLabel(app) }}
            </span>
            <span v-else class="text-xs text-gray-300 dark:text-gray-600">—</span>
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
