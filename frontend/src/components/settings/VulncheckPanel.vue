<script setup lang="ts">
// "VulnCheck" tab (docs/settings.md#vulncheck) — opt-in, per-workspace.
// Permission gate: requires canEditIntegrationSecrets to edit or test.
// Third CVE source (after the Vulnerability Service and MISP), merged into
// the same Apps view / Device modal aggregate — same "no separate section"
// pattern as MISP.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useCatalogsStore } from "../../stores/catalogs";
import { useAuthStore } from "../../stores/auth";

const store = useCatalogsStore();
const auth = useAuthStore();

const canEdit = () => auth.hasRiskyAction("canEditIntegrationSecrets");

const form = reactive({ enabled: false, apiKey: "", cpeGuesserBaseUrl: "", refreshIntervalHours: 12 });
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);
const isTesting = ref(false);
const testError = ref<string | null>(null);
const testResult = ref<string | null>(null);

onMounted(async () => {
  await store.fetchVulncheckConfig();
});

watch(() => store.vulncheckConfig, (cfg) => {
  if (!cfg) return;
  form.enabled = cfg.enabled;
  form.apiKey = "";
  form.cpeGuesserBaseUrl = cfg.cpeGuesserBaseUrl;
  form.refreshIntervalHours = cfg.refreshIntervalHours;
}, { immediate: true });

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await store.saveVulncheckConfig({ enabled: form.enabled, apiKey: form.apiKey, cpeGuesserBaseUrl: form.cpeGuesserBaseUrl, refreshIntervalHours: form.refreshIntervalHours });
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
    const res = await store.testVulncheckConfig({ apiKey: form.apiKey });
    testResult.value = `Connected — ${res.latencyMs}ms.`;
  } catch (err: any) {
    testError.value = err?.response?.data?.detail || "Test connection failed.";
  } finally {
    isTesting.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-lg">
    <p class="text-xs text-gray-400">
      Connects to VulnCheck's hosted CVE intelligence API (community tier — free, no self-hosting) and cross-references
      CVEs against every app and OS version reported across the fleet, the same CPE-translation approach MISP uses.
      Also pulls VulnCheck's own KEV feed to flag known-exploited CVEs. Findings merge directly into the same risk score
      and CVE list the Vulnerability Catalog, Vulnerability Service, and MISP populate — no separate VulnCheck section.
    </p>
    <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saved" type="success">Saved.</Alert>

    <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="checkbox" v-model="form.enabled" :disabled="!canEdit()" /> Enabled
    </label>
    <Input
      v-model="form.apiKey"
      type="password"
      label="VulnCheck API key"
      :placeholder="store.vulncheckConfig?.apiKey ? `Current: ${store.vulncheckConfig.apiKey} — leave blank to keep it` : 'Free at console.vulncheck.com'"
      :disabled="!canEdit()"
    />
    <Input
      v-model="form.cpeGuesserBaseUrl"
      label="CPE guesser base URL (optional)"
      placeholder="Defaults to the public cpe-guesser.cve-search.org"
      :disabled="!canEdit()"
    />
    <p class="text-xs text-gray-400 -mt-2">
      Only app/OS names are sent here to resolve a CPE identifier before querying VulnCheck — same shared translation
      step MISP uses. Point this at a self-hosted cpe-guesser instance instead if that's a concern for your environment.
    </p>
    <Input v-model.number="form.refreshIntervalHours" type="number" label="Refresh interval (hours)" :disabled="!canEdit()" />

    <div class="flex items-center gap-2">
      <Button :loading="isSaving" :disabled="!canEdit()" @click="save">Save</Button>
      <Button variant="ghost" :loading="isTesting" :disabled="!canEdit() || !form.apiKey" @click="test">Test connection</Button>
    </div>
    <Alert v-if="testError" type="danger">{{ testError }}</Alert>
    <Alert v-if="testResult" type="success">{{ testResult }}</Alert>

    <div v-if="store.vulncheckConfig?.enabled" class="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-2">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-200">Status</p>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Last refreshed: {{ store.vulncheckConfig.lastRefreshAt ? new Date(store.vulncheckConfig.lastRefreshAt).toLocaleString() : "Never" }}
      </p>
      <Alert v-if="store.vulncheckConfig.lastRefreshError" type="danger">{{ store.vulncheckConfig.lastRefreshError }}</Alert>
      <pre v-if="store.vulncheckConfig.lastRefreshStats" class="text-xs bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 overflow-x-auto">{{ JSON.stringify(store.vulncheckConfig.lastRefreshStats, null, 2) }}</pre>
      <Button variant="ghost" :loading="store.isRefreshing" @click="store.refreshVulncheckNow()">Refresh now</Button>
    </div>
  </div>
</template>
