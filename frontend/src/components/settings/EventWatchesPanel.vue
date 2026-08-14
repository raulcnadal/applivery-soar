<script setup lang="ts">
// "Event-Driven Detection" tab — disclosed new feature, no main.py/App.jsx
// equivalent. Lets an admin tell the Windows SOAR Agent (Settings > Device
// Data Webhook) to watch specific OS-native signals directly — currently
// just a registry key (RegNotifyChangeKeyValue) — instead of waiting for the
// next scheduled report cycle to notice a change. The agent debounces raw
// OS events locally (`debounceMs`, matching the enhancement request's own
// "5 seconds of quiet" spec) before calling SOAR back, so this never
// replaces the existing poll cycle — see backend's eventWatches.service.ts
// module doc and backend/docs/event-driven-agent-detection-roadmap.md for
// the full design this panel is Phase 0's admin-facing half of.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { computed, onMounted, reactive, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useComplianceStore, WATCH_ACTIONS, WATCH_TYPES, type EventWatchDefinition, type WatchAction, type WatchType } from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";

const store = useComplianceStore();
const auth = useAuthStore();
const canEdit = () => auth.hasFeatureAccess("compliance", "manage");

const WATCH_TYPE_LABELS: Record<WatchType, string> = {
  registryKey: "Registry key change",
};
const ACTION_LABELS: Record<WatchAction, string> = {
  refreshInstalledApps: "Refresh this device's installed-apps inventory",
  evaluateComplianceNow: "Re-evaluate Compliance Policies now",
};

// null = list view, "new" = creating, else the watch id being edited.
const isEditing = ref<string | null>(null);
const form = reactive({
  name: "",
  description: "",
  watchType: "registryKey" as WatchType,
  action: "refreshInstalledApps" as WatchAction,
  debounceMs: 5000,
  enabled: true,
  params: { hive: "HKLM", path: "", watchSubtree: true } as Record<string, any>,
});
const saveError = ref<string | null>(null);
const isSaving = ref(false);

// Windows-only for now (see backend's WATCH_PLATFORMS doc comment) — no
// platform toggle needed the way CustomDeviceChecksPanel.vue has one.
const filteredWatches = computed(() => store.eventWatches.filter((w) => w.platform === "windows"));

function resetForm() {
  form.name = "";
  form.description = "";
  form.watchType = "registryKey";
  form.action = "refreshInstalledApps";
  form.debounceMs = 5000;
  form.enabled = true;
  form.params = { hive: "HKLM", path: "", watchSubtree: true };
}

function startCreate() {
  resetForm();
  isEditing.value = "new";
}

function startEdit(watch: EventWatchDefinition) {
  form.name = watch.name;
  form.description = watch.description ?? "";
  form.watchType = watch.watchType;
  form.action = watch.action;
  form.debounceMs = watch.debounceMs;
  form.enabled = watch.enabled;
  form.params = { hive: "HKLM", path: "", watchSubtree: true, ...(watch.params ?? {}) };
  isEditing.value = watch.id;
}

function cancelEdit() {
  isEditing.value = null;
  saveError.value = null;
  resetForm();
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = {
      platform: "windows" as const,
      name: form.name,
      description: form.description || null,
      watchType: form.watchType,
      params: form.params,
      debounceMs: form.debounceMs,
      action: form.action,
      enabled: form.enabled,
    };
    if (isEditing.value === "new") {
      await store.createEventWatch(payload);
    } else if (isEditing.value) {
      await store.updateEventWatch(isEditing.value, payload);
    }
    cancelEdit();
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save watch.";
  } finally {
    isSaving.value = false;
  }
}

async function remove(watch: EventWatchDefinition) {
  if (!confirm(`Delete "${watch.name}"? The agent will stop watching this signal on its next config poll.`)) return;
  await store.deleteEventWatch(watch.id);
}

async function toggleEnabled(watch: EventWatchDefinition) {
  await store.updateEventWatch(watch.id, {
    platform: watch.platform,
    name: watch.name,
    description: watch.description,
    watchType: watch.watchType,
    params: watch.params,
    debounceMs: watch.debounceMs,
    action: watch.action,
    enabled: !watch.enabled,
  });
}

function targetSummary(watch: EventWatchDefinition): string {
  const p = watch.params || {};
  if (watch.watchType === "registryKey") {
    return `${p.hive || "HKLM"}\\${p.path || ""}${p.watchSubtree ? " (+ subkeys)" : ""}`;
  }
  return "";
}

onMounted(async () => {
  await store.fetchEventWatches();
});
</script>

<template>
  <div>
    <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Event-Driven Detection</h3>
    <div class="space-y-4 max-w-2xl">
      <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        Tell the Windows SOAR Agent to watch specific OS-native signals directly, instead of waiting for its next
        scheduled report cycle to notice a change. The agent debounces locally — it waits for the signal to go quiet
        (the debounce window below, 5 seconds by default) before calling SOAR back, so a burst of activity (e.g.
        installing an app) produces one clean notification, not hundreds. This <strong>supplements</strong> the
        existing report cycle, it never replaces it — a device that's offline or hasn't updated its agent keeps
        working exactly as before. Requires the Applivery SOAR Agent (Settings &gt; Device Data Webhook) — the legacy
        report scripts don't poll for these.
      </p>
      <Alert v-if="store.eventWatchesError" type="danger">{{ store.eventWatchesError }}</Alert>
      <Alert v-if="!canEdit()" type="info">Your role doesn't have manage access to Compliance — every control below is disabled.</Alert>

      <div class="flex items-center gap-1.5">
        <div class="flex-1" />
        <Button v-if="canEdit() && isEditing === null" size="sm" @click="startCreate">+ New watch</Button>
      </div>

      <div v-if="isEditing !== null" class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-2">
        <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
        <Input v-model="form.name" label="Name" placeholder="e.g. Installed apps (Uninstall key)" :disabled="!canEdit()" />
        <Input v-model="form.description" label="Description (optional)" :disabled="!canEdit()" />

        <div>
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Watch type</label>
          <select
            v-model="form.watchType"
            :disabled="!canEdit()"
            class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          >
            <option v-for="t in WATCH_TYPES" :key="t" :value="t">{{ WATCH_TYPE_LABELS[t] }}</option>
          </select>
        </div>

        <template v-if="form.watchType === 'registryKey'">
          <div class="grid grid-cols-[100px_1fr] gap-2">
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Hive</label>
              <select
                v-model="form.params.hive"
                :disabled="!canEdit()"
                class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
              >
                <option value="HKLM">HKLM</option>
                <option value="HKCU">HKCU</option>
              </select>
            </div>
            <Input v-model="form.params.path" label="Key path" placeholder="SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" :disabled="!canEdit()" />
          </div>
          <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
            <input type="checkbox" v-model="form.params.watchSubtree" :disabled="!canEdit()" /> Include subkeys
          </label>
        </template>

        <div>
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">
            Debounce window — how long the signal must stay quiet before the agent notifies SOAR
          </label>
          <div class="flex items-center gap-2">
            <input
              type="number"
              v-model.number="form.debounceMs"
              min="1000"
              max="60000"
              step="500"
              :disabled="!canEdit()"
              class="w-28 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
            />
            <span class="text-[10px] text-gray-400">ms ({{ (form.debounceMs / 1000).toFixed(1) }}s)</span>
          </div>
        </div>

        <div>
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">When this watch fires, SOAR should…</label>
          <select
            v-model="form.action"
            :disabled="!canEdit()"
            class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          >
            <option v-for="a in WATCH_ACTIONS" :key="a" :value="a">{{ ACTION_LABELS[a] }}</option>
          </select>
        </div>

        <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" v-model="form.enabled" :disabled="!canEdit()" /> Enabled
        </label>

        <div class="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" @click="cancelEdit">Cancel</Button>
          <Button size="sm" :loading="isSaving" :disabled="!canEdit() || !form.name || !form.params.path" @click="save">{{ isEditing === "new" ? "Create" : "Save" }}</Button>
        </div>
      </div>

      <p v-if="filteredWatches.length === 0 && isEditing === null" class="text-xs text-gray-500 dark:text-gray-400">No event watches yet.</p>

      <div class="space-y-1.5">
        <div v-for="watch in filteredWatches" :key="watch.id" class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="watch.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'" />
              <p class="text-xs font-semibold truncate text-gray-900 dark:text-white">{{ watch.name }}</p>
              <span class="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400">{{ watch.key }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}10`, color: PRIMARY_BLUE }">{{ (watch.debounceMs / 1000).toFixed(1) }}s debounce</span>
            </div>
            <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate">{{ WATCH_TYPE_LABELS[watch.watchType] }} — {{ targetSummary(watch) }}</p>
            <p class="text-[10px] text-gray-400 truncate">→ {{ ACTION_LABELS[watch.action] }}</p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" :disabled="!canEdit()" @click="toggleEnabled(watch)">{{ watch.enabled ? "Disable" : "Enable" }}</Button>
            <Button size="sm" variant="ghost" :disabled="!canEdit()" @click="startEdit(watch)">Edit</Button>
            <button type="button" class="p-1.5 rounded disabled:opacity-40" style="color: #ef4444" :disabled="!canEdit()" @click="remove(watch)">
              <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
