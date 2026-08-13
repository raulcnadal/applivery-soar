<script setup lang="ts">
// App detail modal — opened from ReportedAppsPanel.vue when an admin clicks
// an app row. Combines three things: the per-device breakdown SOAR already
// has (version/source/update/fetch-error, previously only visible via an
// inline expand), which App Lists (if any) reference this app in our own
// App Catalog, and — Windows only — a best-effort enrichment lookup against
// Applivery's own Windows App Distribution/MDM application library (see
// windowsAppCatalog.service.ts's doc comment for why that match is
// name-based rather than a reliable id join).
import { Alert, Modal } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
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
// local data, matched by (platform, identifier) against the shared App
// Catalog. No Applivery call needed for this part.
const catalogEntry = computed(() => {
  if (!props.app) return null;
  return store.appCatalog.find((e) => e.platform === props.app!.platform && e.identifier.toLowerCase() === props.app!.identifier.toLowerCase()) ?? null;
});
const listsContaining = computed(() => {
  if (!catalogEntry.value) return [];
  return store.appLists.filter((l) => l.appIds.includes(catalogEntry.value!.id));
});

// Windows-only enrichment against Applivery's own application library.
const windowsLookup = ref<{ matched: boolean; application: Record<string, any> | null } | null>(null);
const isLoadingWindowsLookup = ref(false);
const windowsLookupError = ref<string | null>(null);

async function loadWindowsLookup() {
  if (!props.app || props.app.platform !== "windows") return;
  isLoadingWindowsLookup.value = true;
  windowsLookupError.value = null;
  windowsLookup.value = null;
  try {
    windowsLookup.value = await store.fetchWindowsAppDetail(props.app.name);
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
</script>

<template>
  <Modal :open="open" :title="app ? app.name : 'App'" size="lg" @close="emit('close')">
    <div v-if="app" class="space-y-5">
      <div>
        <p class="text-xs text-gray-400 font-mono">{{ app.identifier }}</p>
        <div class="flex items-center gap-2 mt-1 flex-wrap">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/10 text-gray-500 dark:text-gray-400">{{ PLATFORM_LABELS[app.platform] || app.platform }}</span>
          <span class="text-xs text-gray-400">{{ app.deviceCount }} device{{ app.deviceCount === 1 ? "" : "s" }} · {{ app.versions.length }} version{{ app.versions.length === 1 ? "" : "s" }} seen</span>
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

      <!-- Per-device breakdown -->
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Devices</p>
        <div class="border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto">
          <div v-for="d in app.devices" :key="d.deviceId" class="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
            <span class="text-gray-900 dark:text-white truncate">{{ d.deviceName }}</span>
            <span class="flex items-center gap-2 shrink-0 text-gray-400">
              <component v-if="d.updateAvailable" :is="ICONS.CloudDownload" :size="12" weight="Linear" class="text-blue-500" title="Update available" />
              <span class="font-mono">{{ d.version || "—" }}</span>
              <span
                class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
                :class="d.source === 'self_reported' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
              >
                {{ SOURCE_LABELS[d.source] || d.source }}
              </span>
              <span>{{ formatAge(d.fetchedAt) }}</span>
              <component v-if="d.lastFetchError" :is="ICONS.DangerTriangle" :size="11" weight="Linear" class="text-amber-500" :title="d.lastFetchError" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>
