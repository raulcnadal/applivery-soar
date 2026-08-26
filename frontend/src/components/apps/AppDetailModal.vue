<script setup lang="ts">
// App detail modal — opened from ReportedAppsPanel.vue when an admin clicks
// an app row. Combines three things: the per-device breakdown SOAR already
// has (version/source/update/enforced-by-policy/fetch-error, previously only
// visible via an inline expand), which App Lists (if any) reference this app
// in our own App Catalog, and — Windows only — an enrichment lookup against
// Applivery's own Windows App Distribution/MDM application library. That
// lookup matches by MSI product GUID when SOAR fetched the app's productCode
// itself (server_fetch apps), which is authoritative, and falls back to a
// best-effort name match otherwise (self-reported apps have no productCode)
// — see windowsAppCatalog.service.ts's matchWindowsApplication doc comment.
import { Alert, Modal } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import HelpIcon from "../shared/HelpIcon.vue";
import { vulnLink } from "../../utils/vulnLinks";
import { useComplianceStore, type ReportedAppSummary } from "../../stores/compliance";

const props = defineProps<{ open: boolean; app: ReportedAppSummary | null }>();
const emit = defineEmits<{ close: [] }>();

const store = useComplianceStore();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS/iPadOS", macos: "macOS", android: "Android", windows: "Windows" };
const SOURCE_LABELS: Record<string, string> = { self_reported: "Self-reported", server_fetch: "Applivery UEM" };
// Software integrity (VirusTotal file-hash verdict) badge styling — mirrors
// DeviceDetailDrawer.vue's own copy of the same map exactly (see that file's
// doc comment for why "unknown"/"error" aren't treated as risk signals).
// Duplicated rather than shared because these two components don't otherwise
// share a lookup-table module; keep both in sync if verdict values change.
const INTEGRITY_BADGE_CLASS: Record<string, string> = {
  malicious: "bg-red-500/10 text-red-500",
  suspicious: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  unknown: "bg-gray-500/10 text-gray-500 dark:text-gray-400",
  error: "bg-gray-500/10 text-gray-500 dark:text-gray-400",
};
const INTEGRITY_BADGE_LABEL: Record<string, string> = {
  malicious: "Malicious",
  suspicious: "Suspicious",
  unknown: "Not in VirusTotal",
  error: "Check failed",
};

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}
function formatBytes(bytes: number | string | null | undefined): string | null {
  const n = Number(bytes);
  if (!n || Number.isNaN(n)) return null;
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

// Which App Lists (Compliance > App Lists) reference this app — purely
// local data, matched by (platform, identifier-or-name) against the shared
// App Catalog. No Applivery call needed for this part. Matches on name as
// well as identifier for the same reason complianceEvaluate.ts's
// requiredAppList/disallowedAppList matching does: a catalog entry added
// via Winget search stores winget's PackageIdentifier (e.g.
// "Google.Chrome"), but a device's self-report often carries the
// lowercased DisplayName instead ("google chrome") when winget isn't
// invokable from the agent's LocalSystem service context — matching on
// identifier alone would show "not in the App Catalog" for an app that
// demonstrably is, just added/reported under different naming conventions.
//
// Windows Store (AppX/MSIX) apps need a second normalization on top of
// that: a catalog entry added via the MS Store search stores whatever
// Applivery's search API returns as the identifier, which is
// PackageFamilyName-shaped ("<PackageName>_<PublisherId>", e.g.
// "1ED5AEA5.4160926B82DB_p2gbknwb5d8r2"), while the device/UEM-reported
// identifier is always the bare package identity Name — the PublisherId
// segment isn't knowable before the app is actually installed. Stripping
// a trailing "_<13-char base32 PublisherId>" recovers the identity Name
// for comparison (mirrors complianceEvaluate.ts's identical strip).
const stripPackageFamilySuffix = (id: string) => id.replace(/_[a-z0-9]{13}$/i, "");
const catalogEntry = computed(() => {
  if (!props.app) return null;
  const target = props.app.identifier.toLowerCase();
  return (
    store.appCatalog.find((e) => {
      if (e.platform !== props.app!.platform) return false;
      const entryId = e.identifier.toLowerCase();
      return entryId === target || stripPackageFamilySuffix(entryId) === target || (e.name ?? "").toLowerCase() === target;
    }) ?? null
  );
});
const listsContaining = computed(() => {
  if (!catalogEntry.value) return [];
  return store.appLists.filter((l) => l.appIds.includes(catalogEntry.value!.id));
});

// Windows-only enrichment against Applivery's own application library.
const windowsLookup = ref<{ matched: boolean; application: Record<string, any> | null } | null>(null);
const isLoadingWindowsLookup = ref(false);
const windowsLookupError = ref<string | null>(null);

// The MSI product GUID, when SOAR itself fetched this app from the device's
// own CSP data (server_fetch) — lets the catalog lookup match exactly
// instead of falling back to name matching. Self-reported-only apps have no
// productCode, so this is often null; that's expected, not an error.
const windowsProductCode = computed(() => props.app?.devices.find((d) => d.productCode)?.productCode ?? null);

async function loadWindowsLookup() {
  if (!props.app || props.app.platform !== "windows") return;
  isLoadingWindowsLookup.value = true;
  windowsLookupError.value = null;
  windowsLookup.value = null;
  try {
    windowsLookup.value = await store.fetchWindowsAppDetail(props.app.name, windowsProductCode.value);
  } catch (err: any) {
    windowsLookupError.value = err?.response?.data?.detail || "Could not look up Applivery's Windows application catalog.";
  } finally {
    isLoadingWindowsLookup.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) loadWindowsLookup();
  },
);
onMounted(() => {
  if (props.open) loadWindowsLookup();
});

// The Windows catalog entry's `info` shape varies by type (asset/lastBuild/
// store/...) — see windowsAppCatalog.service.ts's doc comment. Pulls out
// whatever's present rather than assuming one fixed shape.
const windowsAppDisplay = computed(() => {
  const info = windowsLookup.value?.application?.info;
  if (!info) return null;
  if (info.error) return { error: String(info.error) };
  const config = info.config ?? {};
  return {
    name: info.name ?? info.applicationInfo?.name ?? null,
    icon: info.icon ?? config.icon ?? info.applicationInfo?.picture ?? null,
    version: info.processedVersionName ?? config.msi?.productVersion ?? config.exe?.productVersion ?? config.msix?.version ?? null,
    manufacturer: config.msi?.manufacturer ?? config.exe?.companyName ?? null,
    sizeBytes: info.size ?? info.file?.size ?? null,
    fileExt: info.originalExtension ?? info.file?.originalExtension ?? null,
    deploymentType: windowsLookup.value?.application?.type ?? null,
  };
});

// Vulnerabilities — per-version CVE breakdown, sourced from app.vulnSummary
// (merged server-side in appLists.controller.ts's reported-apps route via
// vulnService.ts's computeReportedAppsVulnSummaries). Only versions with a
// fresh cached Vulnerability Service match appear in byVersion — a version
// with none isn't shown as an error, it's just omitted, same convention as
// the Risk column on the table view (ReportedAppsPanel.vue).
// Installation paths — every distinct install path reported across this
// app's devices, deduped. Previously only visible via the per-device
// breakdown table further down (each row's own install-path line, still
// there, unchanged), which reads fine for an app installed on exactly one
// device but buries the path entirely once there are several devices each
// scrolling past inside that table's own max-h-64 — this pulls it into its
// own always-visible section instead. Sorted by how many devices report
// each path (most common first), since a fleet is more likely to want to
// confirm "is this the expected install location" than to enumerate every
// device individually here (that's what the table below is for).
// deviceNames collected alongside the count — powers a hover tooltip on the
// device-count badge below, so "which device(s) have this path" is still
// answerable without also printing the path a second time per-row further
// down in the per-device table (see that table's own comment for why the
// redundant line was removed).
const installPaths = computed(() => {
  if (!props.app) return [];
  const byPath = new Map<string, string[]>();
  for (const d of props.app.devices) {
    if (!d.installLocation) continue;
    let names = byPath.get(d.installLocation);
    if (!names) {
      names = [];
      byPath.set(d.installLocation, names);
    }
    names.push(d.deviceName);
  }
  return Array.from(byPath.entries())
    .map(([path, deviceNames]) => ({ path, deviceCount: deviceNames.length, deviceNames }))
    .sort((a, b) => b.deviceCount - a.deviceCount);
});

// Header-level integrity summary — "is this binary flagged on ANY device,"
// same question the per-device badges below answer individually. Only
// "malicious"/"suspicious" count (see INTEGRITY_BADGE_CLASS's doc comment);
// "unknown"/"error" are inconclusive, not a flag.
const flaggedDeviceCount = computed(() => {
  if (!props.app) return 0;
  return props.app.devices.filter((d) => d.integrity?.checked && (d.integrity.verdict === "malicious" || d.integrity.verdict === "suspicious")).length;
});

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: "#EF4444", HIGH: "#F97316", MEDIUM: "#F59E0B", LOW: "#3B82F6" };
const versionsWithVulns = computed(() => {
  if (!props.app?.vulnSummary) return [];
  const byVersion = props.app.vulnSummary.byVersion;
  return props.app.versions.filter((v) => byVersion[v]).map((v) => ({ version: v, info: byVersion[v] }));
});

// Collapsed by default, per version — an app with several reported versions
// (each potentially carrying a dozen-plus CVE rows, per its own cached
// Vulnerability Service match) could otherwise print 30+ rows before the
// admin has even decided which version they care about, growing this modal
// far past the viewport. Empty Set = every version starts collapsed; Vue 3
// tracks Set.add/delete on a ref the same as any other mutation, no need
// for reactive() here.
const expandedVersions = ref<Set<string>>(new Set());
function toggleVersion(version: string) {
  if (expandedVersions.value.has(version)) expandedVersions.value.delete(version);
  else expandedVersions.value.add(version);
}
</script>

<template>
  <Modal :open="open" :title="app ? app.name : 'App'" size="lg" class="max-w-4xl" @close="emit('close')">
    <!-- max-h-[75vh]/overflow-y-auto: Modal (bluesky-vue) itself doesn't cap
         body height (packages/bluesky-vue/src/Modal.vue), so this app's own
         content — particularly the per-version Vulnerabilities section right
         below, which can run to dozens of CVE rows across several versions —
         used to just push the panel past the viewport with no way to reach
         the rest of it. Scrolls here regardless of collapse state, as a
         hard backstop, not just a fix for the (default-collapsed) CVE
         lists specifically. -->
    <div v-if="app" class="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
      <div>
        <div class="flex items-center gap-1.5">
          <p class="text-xs text-gray-400 font-mono">{{ app.identifier }}</p>
          <HelpIcon slug="apps" anchor="vulnerability-service-risk-scoring" title="Apps admin guide" />
        </div>
        <div class="flex items-center gap-2 mt-1 flex-wrap">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/10 text-gray-500 dark:text-gray-400">{{ PLATFORM_LABELS[app.platform] || app.platform }}</span>
          <span class="text-xs text-gray-400">{{ app.deviceCount }} device{{ app.deviceCount === 1 ? "" : "s" }} · {{ app.versions.length }} version{{ app.versions.length === 1 ? "" : "s" }} seen</span>
          <span
            v-if="app.devicesEnforcedByPolicy > 0"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            title="Assigned to the device via Applivery's Windows App Distribution policy — not just present on the device for some other reason."
          >
            <component :is="ICONS.ShieldCheck" :size="11" weight="Linear" />
            Enforced by policy on {{ app.devicesEnforcedByPolicy }} device{{ app.devicesEnforcedByPolicy === 1 ? "" : "s" }}
          </span>
          <span
            v-if="flaggedDeviceCount > 0"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-500"
            title="VirusTotal file-hash reputation check — see the Devices table below for which device(s) and verdict."
          >
            <component :is="ICONS.DangerTriangle" :size="11" weight="Linear" />
            Flagged by VirusTotal on {{ flaggedDeviceCount }} device{{ flaggedDeviceCount === 1 ? "" : "s" }}
          </span>
        </div>
      </div>

      <!-- App List membership -->
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider mb-1.5 text-gray-400">App Lists</p>
        <div v-if="!catalogEntry" class="text-xs text-gray-400 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          Not in the App Catalog under this exact identifier, so it isn't (and can't yet be) referenced by any App List.
        </div>
        <div v-else-if="listsContaining.length === 0" class="text-xs text-gray-400 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          In the App Catalog but not used by any App List yet.
        </div>
        <div v-else class="flex flex-wrap gap-1.5">
          <span v-for="l in listsContaining" :key="l.id" class="px-2 py-1 rounded-lg text-xs font-medium bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-400">
            {{ l.name }}
          </span>
        </div>
      </div>

      <!-- Applivery Windows application catalog enrichment -->
      <div v-if="app.platform === 'windows'">
        <p class="text-xs font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Applivery Application Library</p>
        <p v-if="isLoadingWindowsLookup" class="text-xs text-gray-400">Looking up…</p>
        <Alert v-else-if="windowsLookupError" type="danger">{{ windowsLookupError }}</Alert>
        <div v-else-if="!windowsLookup?.matched" class="text-xs text-gray-400 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          No matching entry found in Applivery's Windows application library (matched by name — this app may never have been deployed through Applivery, or its catalog name differs from what was reported).
        </div>
        <Alert v-else-if="windowsAppDisplay?.error" type="warning">
          Matched a policy-assigned application, but its underlying build/asset was removed from Applivery ({{ windowsAppDisplay.error }}).
        </Alert>
        <div v-else-if="windowsAppDisplay" class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <img v-if="windowsAppDisplay.icon" :src="windowsAppDisplay.icon" class="w-10 h-10 rounded shrink-0" alt="" />
          <component v-else :is="ICONS.Box" :size="24" weight="Linear" class="text-gray-400 shrink-0 mt-1" />
          <div class="min-w-0 text-xs space-y-0.5">
            <p class="font-semibold text-gray-900 dark:text-white">{{ windowsAppDisplay.name || app.name }}</p>
            <p v-if="windowsAppDisplay.manufacturer" class="text-gray-400">{{ windowsAppDisplay.manufacturer }}</p>
            <p class="text-gray-400">
              <span v-if="windowsAppDisplay.version">v{{ windowsAppDisplay.version }}</span>
              <span v-if="windowsAppDisplay.fileExt"> · .{{ windowsAppDisplay.fileExt }}</span>
              <span v-if="formatBytes(windowsAppDisplay.sizeBytes)"> · {{ formatBytes(windowsAppDisplay.sizeBytes) }}</span>
              <span v-if="windowsAppDisplay.deploymentType"> · {{ windowsAppDisplay.deploymentType }}</span>
            </p>
          </div>
        </div>
      </div>

      <!-- Installation Paths — see installPaths' own doc comment for why
           this is broken out of the per-device table below rather than
           only living there. -->
      <div v-if="installPaths.length > 0">
        <p class="text-xs font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Installation Paths</p>
        <div class="space-y-1">
          <div v-for="ip in installPaths" :key="ip.path" class="flex items-start gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
            <component :is="ICONS.Folder" :size="13" weight="Linear" class="shrink-0 text-gray-400 mt-0.5" />
            <span class="font-mono break-all select-all text-gray-900 dark:text-white flex-1">{{ ip.path }}</span>
            <span
              v-if="ip.deviceCount > 1"
              class="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/10 text-gray-500 dark:text-gray-400 cursor-default"
              :title="ip.deviceNames.join('\n')"
            >
              {{ ip.deviceCount }} devices
            </span>
          </div>
        </div>
      </div>

      <!-- Vulnerabilities — per-version CVE breakdown (Vulnerability
           Service). See the Risk column's own doc comment on ReportedAppsPanel.vue
           for why "not enabled" and "no cached match yet" render identically
           (nothing shown at all) rather than as two different states. -->
      <div v-if="versionsWithVulns.length > 0">
        <p class="text-xs font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Vulnerabilities</p>
        <div class="space-y-3">
          <div v-for="{ version, info } in versionsWithVulns" :key="version">
            <button
              v-if="info.cveList.length > 0"
              type="button"
              class="flex items-center gap-1 text-xs font-medium text-gray-900 dark:text-white mb-1 hover:opacity-80"
              @click="toggleVersion(version)"
            >
              <component :is="expandedVersions.has(version) ? ICONS.AltArrowUp : ICONS.AltArrowDown" :size="12" weight="Linear" class="shrink-0 text-gray-400" />
              v{{ version }}
              <span class="font-normal text-gray-400">
                · {{ info.cveList.length }} known CVE{{ info.cveList.length === 1 ? "" : "s" }}{{ info.hasKev ? " · includes a known-exploited (CISA KEV) CVE" : "" }}
              </span>
            </button>
            <p v-else class="text-xs font-medium text-gray-900 dark:text-white mb-1">
              v{{ version }}
              <span class="font-normal" :style="{ color: '#22C55E' }"> · no known CVEs</span>
            </p>
            <div v-if="info.cveList.length > 0 && expandedVersions.has(version)" class="space-y-1 max-h-72 overflow-y-auto">
              <div v-for="c in info.cveList" :key="c.id" class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                <span class="text-gray-900 dark:text-white">
                  <a v-if="vulnLink(c.id)" :href="vulnLink(c.id)!" target="_blank" rel="noopener noreferrer" class="hover:underline text-brand-600 dark:text-brand-400">{{ c.id }}</a>
                  <template v-else>{{ c.id }}</template>
                  <span v-if="c.fixed_in" class="text-gray-400"> · fixed in {{ c.fixed_in }}</span>
                </span>
                <span class="font-semibold shrink-0" :style="{ color: SEVERITY_COLOR[c.severity] || '#9CA3AF' }">
                  {{ c.severity || "Unknown" }}{{ c.is_kev ? " · known-exploited" : "" }}{{ typeof c.epss_score === "number" ? ` · EPSS ${(c.epss_score * 100).toFixed(0)}%` : "" }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p class="text-[10px] mt-2 text-gray-400">From your org's Vulnerability Service integration, per reported version. Versions with no cached match aren't shown.</p>
      </div>

      <!-- Per-device breakdown -->
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Devices</p>
        <div class="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
          <!-- A real grid (not a flexbox that squeezes the name column to
               fit its neighbors) — columns line up across every row
               regardless of device-name length now that the modal itself is
               wider, and a long device name is truncated with the full name
               available on hover rather than silently stripped mid-string. -->
          <div class="hidden sm:grid grid-cols-[minmax(140px,1fr)_92px_60px_168px_150px] gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
            <span>Device</span>
            <span>Version</span>
            <span>Type</span>
            <span>Reported by</span>
            <span>Last sync</span>
          </div>
          <div class="divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto">
            <!-- keyed on deviceId alone: this is one row per physical device
                 now. A device reporting the same app via both the SOAR Agent
                 (self_reported) and Applivery UEM (server_fetch) is merged
                 into a single row with both "Reported by" badges — see
                 installedApps.service.ts's getReportedAppsOverview doc
                 comment for why (an earlier one-row-per-source design read
                 as a data-integrity bug: the same app appearing to be
                 "installed twice" on one device). -->
            <div v-for="d in app.devices" :key="d.deviceId" class="px-2.5 py-1.5">
              <div class="grid grid-cols-2 sm:grid-cols-[minmax(140px,1fr)_140px_60px_168px_150px] gap-2 items-center text-xs">
                <span class="min-w-0 col-span-2 sm:col-span-1 text-gray-900 dark:text-white truncate" :title="d.deviceName">{{ d.deviceName }}</span>
                <span class="flex items-center gap-1 font-mono" :title="d.versionsBySource ? Object.entries(d.versionsBySource).map(([s, v]) => `${SOURCE_LABELS[s] || s}: ${v}`).join(' · ') : undefined">
                  <component
                    v-if="d.enforcedByPolicy"
                    :is="ICONS.ShieldCheck"
                    :size="12"
                    weight="Linear"
                    class="text-emerald-500 shrink-0"
                    title="Enforced by Applivery's Windows App Distribution policy on this device"
                  />
                  <component v-if="d.updateAvailable" :is="ICONS.CloudDownload" :size="12" weight="Linear" class="text-blue-500 shrink-0" title="Update available" />
                  <!-- Not truncate: version strings are short but not THAT
                       short (Apple's "26.6.2 (25G82)", Windows'
                       "10.0.28000.2704") — at the old 92px column width
                       these silently lost their tail with no visual
                       indicator at all (no ellipsis even), the exact bug
                       this column-width bump + break-words is fixing. -->
                  <span class="break-words">{{ d.version || "—" }}</span>
                  <span v-if="d.versionsBySource" class="text-amber-500 shrink-0">⚠</span>
                </span>
                <span>
                  <span
                    v-if="d.origin === 'store'"
                    class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-violet-500/10 text-violet-500 whitespace-nowrap"
                  >
                    Store
                  </span>
                  <span
                    v-else-if="d.origin === 'winget'"
                    class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 whitespace-nowrap"
                  >
                    Winget
                  </span>
                  <span
                    v-else-if="d.origin === 'msi'"
                    class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-sky-500/10 text-sky-500 whitespace-nowrap"
                  >
                    MSI
                  </span>
                  <span v-else class="text-gray-300 dark:text-gray-600">—</span>
                </span>
                <!-- One badge per contributing source — both shown side by
                     side when both the SOAR Agent and Applivery UEM see this
                     app on this device, rather than picking just one. -->
                <span class="flex items-center gap-1 flex-wrap">
                  <span
                    v-for="s in d.sources"
                    :key="s"
                    class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap"
                    :class="s === 'self_reported' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
                  >
                    {{ SOURCE_LABELS[s] || s }}
                  </span>
                </span>
                <!-- Last sync — its own column rather than a bare trailing
                     timestamp, and the sync-failure triangle lives here
                     specifically (not floating next to version/source), since
                     it's a freshness/sync-health signal, not a data-quality one. -->
                <span class="flex items-center gap-1 text-gray-400" :title="d.lastFetchError ? `Last live-fetch error: ${d.lastFetchError}` : undefined">
                  <span>{{ formatAge(d.lastSyncAt) }}</span>
                  <component v-if="d.lastFetchError" :is="ICONS.DangerTriangle" :size="11" weight="Linear" class="text-amber-500 shrink-0" />
                </span>
              </div>
              <!-- Install path is intentionally NOT repeated here — it's
                   already shown once, deduped, under "Installation Paths"
                   above (with a hover tooltip on the device-count badge
                   listing which device(s) have it), and printing it again
                   per-row here just crowded an already-dense table once a
                   device had many apps and/or the paths were long WindowsApps
                   strings. -->
              <div v-if="d.integrity?.checked && d.integrity.verdict !== 'clean'" class="mt-1 flex items-center gap-1.5 text-[10px]">
                <span
                  class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap"
                  :class="INTEGRITY_BADGE_CLASS[d.integrity.verdict] || 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
                  :title="d.integrity.detail"
                >
                  {{ INTEGRITY_BADGE_LABEL[d.integrity.verdict] || d.integrity.verdict }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>
