<script setup lang="ts">
// "Android Security Bulletin" tab (docs/settings.md#android-security-bulletin-osvdev)
// — opt-in, per-workspace. Fourth CVE source (after the Vulnerability
// Service, MISP, and VulnCheck), merged into the same Apps view / Device
// modal aggregate. Free/public OSV.dev data — no API key field, unlike the
// other three connectors.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useCatalogsStore } from "../../stores/catalogs";
import { useAuthStore } from "../../stores/auth";

const store = useCatalogsStore();
const auth = useAuthStore();

const canEdit = () => auth.hasRiskyAction("canEditIntegrationSecrets");

const form = reactive({ enabled: false, refreshIntervalHours: 24 });
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);
const isTesting = ref(false);
const testError = ref<string | null>(null);
const testResult = ref<string | null>(null);

onMounted(async () => {
  await store.fetchOsvAndroidConfig();
});

watch(() => store.osvAndroidConfig, (cfg) => {
  if (!cfg) return;
  form.enabled = cfg.enabled;
  form.refreshIntervalHours = cfg.refreshIntervalHours;
}, { immediate: true });

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await store.saveOsvAndroidConfig({ enabled: form.enabled, refreshIntervalHours: form.refreshIntervalHours });
    saved.value = true;
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save.";
  } finally {
    isSaving.value = false;
  }
}

async function test() {
  isTesting.value = true;
  testError.value = null;
  testResult.value = null;
  try {
    const res = await store.testOsvAndroidConfig();
    const sizeMb = res.sizeBytes ? ` (${(res.sizeBytes / 1_000_000).toFixed(1)} MB dump)` : "";
    testResult.value = `Reachable — ${res.latencyMs}ms${sizeMb}.`;
  } catch (err: any) {
    testError.value = err?.response?.data?.detail || "Could not reach OSV.dev's Android bulk dump.";
  } finally {
    isTesting.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-lg">
    <p class="text-xs text-gray-400">
      Google's own Android Security Bulletin, in structured form via OSV.dev's public "Android" ecosystem mirror — free,
      no API key. Cross-references every Android device's OS version against the full bulletin history. Findings merge
      into the same risk score and CVE list the Vulnerability Catalog, Vulnerability Service, MISP, and VulnCheck
      populate — no separate section.
    </p>
    <Alert type="info">
      This app doesn't currently capture a device's exact Security Patch Level — only its Android major version — so
      matching is necessarily coarse: every CVE ever disclosed for that major version is surfaced, whether or not this
      specific device has already patched it. Treat results as "CVEs disclosed for this Android version," not a precise
      per-device exposure count.
    </Alert>
    <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saved" type="success">Saved.</Alert>

    <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="checkbox" v-model="form.enabled" :disabled="!canEdit()" /> Enabled
    </label>
    <Input v-model.number="form.refreshIntervalHours" type="number" label="Refresh interval (hours)" :disabled="!canEdit()" />
    <p class="text-xs text-gray-400 -mt-2">Default 24h. The bulletin itself is only published monthly, so there's little value refreshing more often than daily.</p>

    <div class="flex items-center gap-2">
      <Button :loading="isSaving" :disabled="!canEdit()" @click="save">Save</Button>
      <Button variant="ghost" :loading="isTesting" :disabled="!canEdit()" @click="test">Test connection</Button>
    </div>
    <Alert v-if="testError" type="danger">{{ testError }}</Alert>
    <Alert v-if="testResult" type="success">{{ testResult }}</Alert>

    <div v-if="store.osvAndroidConfig?.enabled" class="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-2">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-200">Status</p>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Last refreshed: {{ store.osvAndroidConfig.lastRefreshAt ? new Date(store.osvAndroidConfig.lastRefreshAt).toLocaleString() : "Never" }}
      </p>
      <Alert v-if="store.osvAndroidConfig.lastRefreshError" type="danger">{{ store.osvAndroidConfig.lastRefreshError }}</Alert>
      <pre v-if="store.osvAndroidConfig.lastRefreshStats" class="text-xs bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 overflow-x-auto">{{ JSON.stringify(store.osvAndroidConfig.lastRefreshStats, null, 2) }}</pre>
      <Button variant="ghost" :loading="store.isRefreshing" @click="store.refreshOsvAndroidNow()">Refresh now</Button>
    </div>
  </div>
</template>
