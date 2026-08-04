<script setup lang="ts">
// "General" tab (docs/settings.md#general) — workspace-wide defaults not
// tied to any one feature. No permission gate — any signed-in admin can
// edit it. Backed by GET/POST /api/state (dashboardState store, Phase 7).
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useDashboardStateStore } from "../../stores/dashboardState";

const store = useDashboardStateStore();

const SESSION_TIMEOUT_OPTIONS = [
  { value: 30, label: "30 minutes" },
  { value: 60, label: "60 minutes" },
  { value: 90, label: "90 minutes" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
];

const form = reactive({ webhookUrl: "", timezone: "UTC", sessionTimeoutMinutes: 30 });
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);

onMounted(async () => {
  if (!store.isLoaded) await store.fetchState();
});

watch(() => store.isLoaded, (loaded) => {
  if (!loaded) return;
  form.webhookUrl = store.webhookUrl;
  form.timezone = store.timezone;
  form.sessionTimeoutMinutes = store.sessionTimeoutMinutes ?? 30;
}, { immediate: true });

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await store.saveState({
      webhookUrl: form.webhookUrl,
      timezone: form.timezone,
      sessionTimeoutMinutes: form.sessionTimeoutMinutes,
    });
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
    <!-- store.error surfaces a failed GET /api/state on mount -- without
         this, a failed fetch left `form` silently sitting at its hardcoded
         defaults with no indication anything was wrong, which looks
         identical to "my setting got reset" even though nothing was ever
         actually lost server-side. -->
    <Alert v-if="store.error" type="danger">Couldn't load current settings: {{ store.error }}</Alert>
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saved" type="success">Saved.</Alert>

    <Input v-model="form.webhookUrl" label="Notifications Webhook URL" placeholder="https://chat.googleapis.com/v1/spaces/..." />
    <p class="text-xs text-gray-400 -mt-3">Feeds this app's own outbound chat notifications (a Google Chat space webhook). Used by Reporting's "Send to Webhook" delivery option.</p>

    <Input v-model="form.timezone" label="System Timezone (for Scheduled Reports)" placeholder="UTC" />

    <Input
      :model-value="form.sessionTimeoutMinutes"
      type="select"
      :options="SESSION_TIMEOUT_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))"
      label="Idle Session Timeout"
      @update:model-value="form.sessionTimeoutMinutes = Number($event)"
    />
    <p class="text-xs text-gray-400 -mt-3">Signs everyone out automatically after this much inactivity.</p>

    <Button :loading="isSaving" @click="save">Save</Button>
  </div>
</template>
