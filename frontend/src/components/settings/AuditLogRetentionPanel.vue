<script setup lang="ts">
// "Audit Log" settings tab (docs/settings.md#audit-log) — one dropdown, no
// permission gate. Distinct from the Audit Logs *view* (AuditLogsView.vue);
// this only controls retention. Backed by /api/state's auditLogRetentionDays.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, ref, watch } from "vue";
import { useDashboardStateStore } from "../../stores/dashboardState";

const store = useDashboardStateStore();

// null/undefined -> "Forever" (0), matching retentionLabel's convention on
// the backend (dashboardState.controller.ts: days <= 0 => "forever").
const RETENTION_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "365 days" },
  { value: "0", label: "Forever" },
];

const days = ref("90");
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);

onMounted(async () => {
  if (!store.isLoaded) await store.fetchState();
});

watch(() => store.isLoaded, (loaded) => {
  if (!loaded) return;
  days.value = String(store.auditLogRetentionDays ?? 90);
}, { immediate: true });

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await store.saveState({ auditLogRetentionDays: Number(days.value) });
    saved.value = true;
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-md">
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saved" type="success">Saved.</Alert>
    <Input
      :model-value="days"
      type="select"
      :options="RETENTION_OPTIONS"
      label="Keep audit log events for"
      @update:model-value="days = $event as string"
    />
    <p class="text-xs text-gray-400 -mt-3">Older events are rotated out once a day. Applies to the Audit Logs view and the alert history behind policy evaluations.</p>
    <Button :loading="isSaving" @click="save">Save</Button>
  </div>
</template>
