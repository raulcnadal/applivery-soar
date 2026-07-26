<script setup lang="ts">
// Case SLA thresholds per severity. Port of CaseSlaSettingsPayload
// (main.py:12431-12438).
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useCasesStore } from "../../stores/cases";

const store = useCasesStore();

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

const form = reactive({
  enabled: true, notifyOnBreach: true,
  thresholds: Object.fromEntries(SEVERITIES.map((s) => [s, { acknowledgeMinutes: 240, resolveMinutes: 1440 }])) as Record<string, { acknowledgeMinutes: number; resolveMinutes: number }>,
});
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saveMessage = ref<string | null>(null);

function loadFromStore() {
  const s = store.slaSettings;
  if (!s) return;
  form.enabled = s.enabled;
  form.notifyOnBreach = s.notifyOnBreach;
  for (const sev of SEVERITIES) {
    if (s.thresholds[sev]) form.thresholds[sev] = { ...s.thresholds[sev] };
  }
}

onMounted(async () => {
  await store.fetchSlaSettings();
  loadFromStore();
});
watch(() => store.slaSettings, loadFromStore);

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saveMessage.value = null;
  try {
    await store.updateSlaSettings({ enabled: form.enabled, notifyOnBreach: form.notifyOnBreach, thresholds: form.thresholds });
    saveMessage.value = "Saved.";
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save SLA settings.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-2xl">
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saveMessage" type="info">{{ saveMessage }}</Alert>

    <div class="flex flex-wrap gap-4">
      <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.enabled" /> SLA tracking enabled</label>
      <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.notifyOnBreach" /> Notify integrations on breach</label>
    </div>

    <div class="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
      <div v-for="sev in SEVERITIES" :key="sev" class="grid grid-cols-3 gap-3 items-center px-4 py-3">
        <p class="text-sm font-medium text-gray-900 capitalize">{{ sev }}</p>
        <Input v-model.number="form.thresholds[sev].acknowledgeMinutes" type="number" label="Acknowledge (minutes)" />
        <Input v-model.number="form.thresholds[sev].resolveMinutes" type="number" label="Resolve (minutes)" />
      </div>
    </div>

    <Button :loading="isSaving" @click="save">Save SLA settings</Button>
  </div>
</template>
