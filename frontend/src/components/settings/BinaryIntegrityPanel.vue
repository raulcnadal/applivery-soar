<script setup lang="ts">
// "Binary Integrity" tab (docs/settings.md#binary-integrity) — opt-in via the
// existing VirusTotal Threat Intel provider (Settings > Threat Intel), no
// separate API key here. Hashes self-reported app binaries (Windows .exe,
// macOS .app executable) and looks up each SHA256 against VirusTotal's file
// reputation to flag sideloaded/unverified/malicious software. Surfaced as a
// sibling `integrity` badge on each app row in the Device detail drawer —
// not merged into the CVE-based vuln score.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useCatalogsStore } from "../../stores/catalogs";
import { useAuthStore } from "../../stores/auth";

const store = useCatalogsStore();
const auth = useAuthStore();

const canEdit = () => auth.hasRiskyAction("canEditIntegrationSecrets");

const form = reactive({ refreshIntervalHours: 24 });
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);

onMounted(async () => {
  await store.fetchBinaryIntegrityConfig();
});

watch(() => store.binaryIntegrityConfig, (cfg) => {
  if (!cfg) return;
  form.refreshIntervalHours = cfg.refreshIntervalHours;
}, { immediate: true });

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await store.saveBinaryIntegrityConfig({ refreshIntervalHours: form.refreshIntervalHours });
    saved.value = true;
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-lg">
    <p class="text-xs text-gray-400">
      Hashes self-reported app binaries (Windows executables, macOS app bundles) and checks each SHA256 against
      VirusTotal's file reputation database to flag sideloaded, unverified, or malicious software running on
      endpoints. Reuses the VirusTotal connector already configured under Threat Intel — no separate API key here.
      Results appear as a badge on each app in the Device detail drawer, alongside (not merged into) the CVE-based
      vulnerability score.
    </p>
    <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>
    <Alert v-if="store.binaryIntegrityConfig && !store.binaryIntegrityConfig.virustotalConfigured" type="warning">
      No VirusTotal connector is enabled yet. Configure and enable it under Settings &gt; Threat Intel before this
      feature can look anything up.
    </Alert>
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saved" type="success">Saved.</Alert>

    <Input v-model.number="form.refreshIntervalHours" type="number" label="Refresh interval (hours)" :disabled="!canEdit()" />

    <div class="flex items-center gap-2">
      <Button :loading="isSaving" :disabled="!canEdit()" @click="save">Save</Button>
    </div>

    <div v-if="store.binaryIntegrityConfig" class="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-2">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-200">Status</p>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Last refreshed: {{ store.binaryIntegrityConfig.lastRefreshAt ? new Date(store.binaryIntegrityConfig.lastRefreshAt).toLocaleString() : "Never" }}
      </p>
      <Alert v-if="store.binaryIntegrityConfig.lastRefreshError" type="danger">{{ store.binaryIntegrityConfig.lastRefreshError }}</Alert>
      <pre v-if="store.binaryIntegrityConfig.lastRefreshStats" class="text-xs bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 overflow-x-auto">{{ JSON.stringify(store.binaryIntegrityConfig.lastRefreshStats, null, 2) }}</pre>
      <Button variant="ghost" :loading="store.isRefreshing" :disabled="!store.binaryIntegrityConfig.virustotalConfigured" @click="store.refreshBinaryIntegrityNow()">Refresh now</Button>
    </div>
  </div>
</template>
