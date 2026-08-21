<script setup lang="ts">
// "Apple Security Releases" tab (docs/settings.md#apple-security-releases-sofa)
// — opt-in, per-workspace. Fifth CVE source (after the Vulnerability
// Service, MISP, VulnCheck, and Android Security Bulletin), merged into the
// same Apps view / Device modal aggregate. Free/public SOFA data (macadmins
// community) — no API key field, unlike MISP/VulnCheck.
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
  await store.fetchSofaConfig();
});

watch(() => store.sofaConfig, (cfg) => {
  if (!cfg) return;
  form.enabled = cfg.enabled;
  form.refreshIntervalHours = cfg.refreshIntervalHours;
}, { immediate: true });

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await store.saveSofaConfig({ enabled: form.enabled, refreshIntervalHours: form.refreshIntervalHours });
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
    const res = await store.testSofaConfig();
    testResult.value = `Both feeds reachable — ${res.latencyMs}ms.`;
  } catch (err: any) {
    testError.value = err?.response?.data?.detail || "Could not reach one or both SOFA feed URLs.";
  } finally {
    isTesting.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-lg">
    <p class="text-xs text-gray-400">
      Apple's own per-release security-content disclosures for macOS and iOS/iPadOS, republished in structured JSON by
      the macadmins community's <a href="https://sofa.macadmins.io" target="_blank" rel="noopener" class="underline">SOFA</a>
      feed — free, no API key. Unlike the Android Security Bulletin connector, this one matches a device's exact
      reported OS version against Apple's release history, so results reflect precisely which CVEs that device hasn't
      received a fix for yet — not a coarse major-version bucket. If <strong>OS Patch Level</strong> (Settings &gt;
      Workspace Automation) is mapped, the version portion of that Smart Attribute is preferred over Applivery's own
      synced OS version, since it may be fresher. Findings merge into the same risk score and CVE list
      the Vulnerability Catalog, Vulnerability Service, MISP, VulnCheck, and Android Security Bulletin populate — no
      separate section.
    </p>
    <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saved" type="success">Saved.</Alert>

    <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="checkbox" v-model="form.enabled" :disabled="!canEdit()" /> Enabled
    </label>
    <Input v-model.number="form.refreshIntervalHours" type="number" label="Refresh interval (hours)" :disabled="!canEdit()" />
    <p class="text-xs text-gray-400 -mt-2">Default 24h. SOFA itself updates roughly daily; Apple's own out-of-band emergency patches will show up on the next scheduled refresh.</p>

    <div class="flex items-center gap-2">
      <Button :loading="isSaving" :disabled="!canEdit()" @click="save">Save</Button>
      <Button variant="ghost" :loading="isTesting" :disabled="!canEdit()" @click="test">Test connection</Button>
    </div>
    <Alert v-if="testError" type="danger">{{ testError }}</Alert>
    <Alert v-if="testResult" type="success">{{ testResult }}</Alert>

    <div v-if="store.sofaConfig?.enabled" class="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-2">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-200">Status</p>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Last refreshed: {{ store.sofaConfig.lastRefreshAt ? new Date(store.sofaConfig.lastRefreshAt).toLocaleString() : "Never" }}
      </p>
      <Alert v-if="store.sofaConfig.lastRefreshError" type="danger">{{ store.sofaConfig.lastRefreshError }}</Alert>
      <pre v-if="store.sofaConfig.lastRefreshStats" class="text-xs bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 overflow-x-auto">{{ JSON.stringify(store.sofaConfig.lastRefreshStats, null, 2) }}</pre>
      <Button variant="ghost" :loading="store.isRefreshing" @click="store.refreshSofaNow()">Refresh now</Button>
    </div>
  </div>
</template>
