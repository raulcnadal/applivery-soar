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
const catalogEntry = computed(() => {
  if (!props.app) return null;
  const target = props.app.identifier.toLowerCase();
  return store.appCatalog.find((e) => e.platform === props.app!.platform && (e.identifier.toLowerCase() === target || (e.name ?? "").toLowerCase() === target)) ?? null;
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
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: "#EF4444", HIGH: "#F97316", MEDIUM: "#F59E0B", LOW: "#3B82F6" };
const versionsWithVulns = computed(() => {
  if (!props.app?.vulnSummary) return [];
  const byVersion = props.app.vulnSummary.byVersion;
  return props.app.versions.filter((v) => byVersion[v]).map((v) => ({ version: v, info: byVersion[v] }));
});
</script>

<template>
  <Modal :open="open" :title="app ? app.name : 'App'" size="lg" class="max-w-3xl" @close="emit('close')">
    <div v-if="app" class="space-y-5">
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

      <!-- Vulnerabilities — per-version CVE breakdown (Vulnerability
           Service). See the Risk column's own doc comment on ReportedAppsPanel.vue
           for why "not enabled" and "no cached match yet" render identically
           (nothing shown at all) rather than as two different states. -->
      <div v-if="versionsWithVulns.length > 0">
        <p class="text-xs font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Vulnerabilities</p>
        <div class="space-y-3">
          <div v-for="{ version, info } in versionsWithVulns" :key="version">
            <p class="text-xs font-medium text-gray-900 dark:text-white mb-1">
              v{{ version }}
              <span v-if="info.cveList.length === 0" class="font-normal" :style="{ color: '#22C55E' }"> · no known CVEs</span>
              <span v-else class="font-normal text-gray-400">
                · {{ info.cveList.length }} known CVE{{ info.cveList.length === 1 ? "" : "s" }}{{ info.hasKev ? " · includes a known-exploited (CISA KEV) CVE" : "" }}
              </span>
            </p>
            <div v-if="info.cveList.length > 0" class="space-y-1">
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
            <div v-for="d in app.devices" :key="d.deviceId" class="grid grid-cols-2 sm:grid-cols-[minmax(140px,1fr)_92px_60px_168px_150px] gap-2 items-center px-2.5 py-1.5 text-xs">
              <span class="text-gray-900 dark:text-white truncate col-span-2 sm:col-span-1" :title="d.deviceName">{{ d.deviceName }}</span>
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
                <span class="truncate">{{ d.version || "—" }}</span>
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
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>
