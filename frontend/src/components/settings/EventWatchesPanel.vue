<script setup lang="ts">
// "Event-Driven Detection" tab — disclosed new feature, no main.py/App.jsx
// equivalent. Lets an admin tell the Windows SOAR Agent (Settings > Device
// Data Webhook) to watch specific OS-native signals directly — a registry
// key (RegNotifyChangeKeyValue) or an ETW provider — instead of waiting for
// the next scheduled report cycle to notice a change. The agent debounces
// raw OS events locally (`debounceMs`, matching the enhancement request's
// own "5 seconds of quiet" spec) before calling SOAR back, so this never
// replaces the existing poll cycle. Also carries Phase 4's rollout
// controls (workspace kill switch, remote IntervalSec override) and
// notify metrics — see backend's eventWatches.service.ts module doc and
// backend/docs/event-driven-agent-detection-roadmap.md for the full design.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { computed, onMounted, reactive, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import {
  useComplianceStore,
  WATCH_ACTIONS,
  type EventWatchDefinition,
  type WatchAction,
  type WatchPlatform,
  type WatchType,
} from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";

const store = useComplianceStore();
const auth = useAuthStore();
const canEdit = () => auth.hasFeatureAccess("compliance", "manage");

// registryKey/etwProvider are Windows-only; fsEventsPath/launchdJobState are
// macOS-only (macOS parity roadmap Phase 5) — same disjoint-per-platform
// split as the backend's WATCH_TYPES.
const WATCH_TYPES_FOR_PLATFORM: Record<WatchPlatform, readonly WatchType[]> = {
  windows: ["registryKey", "etwProvider"],
  macos: ["fsEventsPath", "launchdJobState"],
};
const WATCH_TYPE_LABELS: Record<WatchType, string> = {
  registryKey: "Registry key change",
  etwProvider: "ETW provider event",
  fsEventsPath: "File/folder change (fsnotify)",
  launchdJobState: "Launchd job state change",
};
const ACTION_LABELS: Record<WatchAction, string> = {
  refreshInstalledApps: "Refresh this device's installed-apps inventory",
  evaluateComplianceNow: "Re-evaluate Compliance Policies now",
};

function defaultParamsFor(watchType: WatchType): Record<string, any> {
  if (watchType === "etwProvider") return { provider: "", eventIds: [] as number[], level: null };
  if (watchType === "fsEventsPath") return { path: "", recursive: false };
  if (watchType === "launchdJobState") return { label: "" };
  return { hive: "HKLM", path: "", watchSubtree: true };
}

const platform = ref<WatchPlatform>("windows");

// null = list view, "new" = creating, else the watch id being edited.
const isEditing = ref<string | null>(null);
const form = reactive({
  name: "",
  description: "",
  watchType: "registryKey" as WatchType,
  action: "refreshInstalledApps" as WatchAction,
  debounceMs: 5000,
  enabled: true,
  params: defaultParamsFor("registryKey"),
});
// Comma-separated Event IDs input for etwProvider watches — kept out of
// form.params directly so the text field can hold transient/partial input
// (e.g. "1,") without needing to be valid JSON numbers on every keystroke;
// parsed into form.params.eventIds only at save() time.
const etwEventIdsText = ref("");
const saveError = ref<string | null>(null);
const isSaving = ref(false);

const filteredWatches = computed(() => store.eventWatches.filter((w) => w.platform === platform.value));

// Switching the platform toggle mid-creation should reset the watch type to
// that platform's first option and clear params, same reasoning as
// onWatchTypeChange below — a Windows registryKey's params are meaningless
// once you're creating a macOS watch.
function onPlatformChange() {
  form.watchType = WATCH_TYPES_FOR_PLATFORM[platform.value][0];
  form.params = defaultParamsFor(form.watchType);
  etwEventIdsText.value = "";
}

function resetForm() {
  form.name = "";
  form.description = "";
  form.watchType = WATCH_TYPES_FOR_PLATFORM[platform.value][0];
  form.action = "refreshInstalledApps";
  form.debounceMs = 5000;
  form.enabled = true;
  form.params = defaultParamsFor(form.watchType);
  etwEventIdsText.value = "";
}

// Switching watch type mid-creation should reset params to that type's own
// shape — carrying over e.g. a registry path into an ETW watch's params
// would just be silently ignored by the backend, better to start clean.
function onWatchTypeChange() {
  form.params = defaultParamsFor(form.watchType);
  etwEventIdsText.value = "";
}

function startCreate() {
  resetForm();
  isEditing.value = "new";
}

function startEdit(watch: EventWatchDefinition) {
  platform.value = watch.platform;
  form.name = watch.name;
  form.description = watch.description ?? "";
  form.watchType = watch.watchType;
  form.action = watch.action;
  form.debounceMs = watch.debounceMs;
  form.enabled = watch.enabled;
  form.params = { ...defaultParamsFor(watch.watchType), ...(watch.params ?? {}) };
  etwEventIdsText.value = Array.isArray(form.params.eventIds) ? form.params.eventIds.join(",") : "";
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
    const params = { ...form.params };
    if (form.watchType === "etwProvider") {
      const ids = etwEventIdsText.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 65535);
      params.eventIds = ids;
      if (params.level === null || params.level === "") delete params.level;
    }
    const payload = {
      platform: platform.value,
      name: form.name,
      description: form.description || null,
      watchType: form.watchType,
      params,
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
  if (watch.watchType === "etwProvider") {
    const ids = Array.isArray(p.eventIds) && p.eventIds.length > 0 ? ` (Event IDs ${p.eventIds.join(", ")})` : " (all events)";
    return `${p.provider || ""}${ids}`;
  }
  if (watch.watchType === "fsEventsPath") {
    return `${p.path || ""}${p.recursive ? " (recursive)" : ""}`;
  }
  if (watch.watchType === "launchdJobState") {
    return p.label || "";
  }
  return "";
}

// Save button is disabled until the current watchType's required params are
// filled in — mirrors validateWatchParams' own required fields (backend
// eventWatches.schemas.ts) so the button doesn't invite a request that's
// just going to 400.
const paramsIncomplete = computed(() => {
  if (form.watchType === "registryKey") return !form.params.path;
  if (form.watchType === "etwProvider") return !form.params.provider;
  if (form.watchType === "fsEventsPath") return !form.params.path || !String(form.params.path).startsWith("/");
  if (form.watchType === "launchdJobState") return !form.params.label;
  return false;
});

// ── Phase 4 rollout controls — workspace-wide kill switch + IntervalSec
// remote-override lever. See backend's eventWatches.service.ts
// getEventDrivenSettings doc comment. ──
const settingsEnabled = ref(true);
// Empty string = "no override, defer to each device's local registry
// value" (maps to remoteIntervalSec: null on save) — kept as a string so
// the input can be genuinely empty rather than coerced to 0.
const remoteIntervalSecInput = ref("");
const isSavingSettings = ref(false);
const settingsSaveError = ref<string | null>(null);

function syncSettingsForm() {
  settingsEnabled.value = store.eventDrivenSettings.enabled;
  remoteIntervalSecInput.value = store.eventDrivenSettings.remoteIntervalSec != null ? String(store.eventDrivenSettings.remoteIntervalSec) : "";
}

async function saveSettings() {
  isSavingSettings.value = true;
  settingsSaveError.value = null;
  try {
    const trimmed = remoteIntervalSecInput.value.trim();
    const remoteIntervalSec = trimmed === "" ? null : Math.max(30, Math.min(86_400, Math.trunc(Number(trimmed))));
    await store.updateEventDrivenSettings({ enabled: settingsEnabled.value, remoteIntervalSec });
    syncSettingsForm();
  } catch (err: any) {
    settingsSaveError.value = err?.response?.data?.detail || "Failed to save settings.";
  } finally {
    isSavingSettings.value = false;
  }
}

const settingsDirty = computed(() => {
  const currentRemote = store.eventDrivenSettings.remoteIntervalSec != null ? String(store.eventDrivenSettings.remoteIntervalSec) : "";
  return settingsEnabled.value !== store.eventDrivenSettings.enabled || remoteIntervalSecInput.value.trim() !== currentRemote;
});

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

onMounted(async () => {
  await Promise.all([store.fetchEventWatches(), store.fetchEventDrivenSettings(), store.fetchEventWatchMetrics()]);
  syncSettingsForm();
});
</script>

<template>
  <div>
    <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Event-Driven Detection</h3>
    <div class="space-y-4 max-w-2xl">
      <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        Tell the SOAR Agent to watch specific OS-native signals directly, instead of waiting for its next scheduled
        report cycle to notice a change. The agent debounces locally — it waits for the signal to go quiet (the
        debounce window below, 5 seconds by default) before calling SOAR back, so a burst of activity (e.g.
        installing an app) produces one clean notification, not hundreds. This <strong>supplements</strong> the
        existing report cycle, it never replaces it — a device that's offline or hasn't updated its agent keeps
        working exactly as before. Requires the Applivery SOAR Agent, configured under Settings &gt; Applivery SOAR
        Agent — the legacy report scripts don't poll for these.
      </p>
      <Alert v-if="store.eventWatchesError" type="danger">{{ store.eventWatchesError }}</Alert>
      <Alert v-if="!canEdit()" type="info">Your role doesn't have manage access to Compliance — every control below is disabled.</Alert>

      <div class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-2">
        <h4 class="text-xs font-bold text-gray-900 dark:text-white">Rollout controls</h4>
        <Alert v-if="store.eventDrivenSettingsError" type="danger">{{ store.eventDrivenSettingsError }}</Alert>
        <Alert v-if="settingsSaveError" type="danger">{{ settingsSaveError }}</Alert>
        <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" v-model="settingsEnabled" :disabled="!canEdit()" />
          Event-driven detection enabled for this workspace
        </label>
        <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
          Workspace-wide kill switch — turning this off stops every agent's watchers on its next poll, regardless of
          which individual watches below are enabled. Individual watches keep their own settings, ready to resume the
          moment this is switched back on.
        </p>
        <div>
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">
            Remote report interval override (seconds, optional)
          </label>
          <div class="flex items-center gap-2">
            <input
              type="number"
              v-model="remoteIntervalSecInput"
              min="30"
              max="86400"
              placeholder="unset — use each device's local registry value"
              :disabled="!canEdit()"
              class="w-64 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400 mt-1">
            Once event-driven watches are confirmed working, you can safely relax the normal report cycle (e.g. from
            1h to 4h) without losing responsiveness — the watches above still catch changes within seconds. Leave
            blank to keep using each device's local Managed Configuration IntervalSec value unchanged.
          </p>
        </div>
        <div class="flex justify-end">
          <Button size="sm" :loading="isSavingSettings" :disabled="!canEdit() || !settingsDirty" @click="saveSettings">Save</Button>
        </div>
      </div>

      <div class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-2">
        <h4 class="text-xs font-bold text-gray-900 dark:text-white">Metrics (last {{ store.eventWatchMetrics?.windowHours ?? 24 }}h)</h4>
        <Alert v-if="store.eventWatchMetricsError" type="danger">{{ store.eventWatchMetricsError }}</Alert>
        <div v-if="store.eventWatchMetrics" class="grid grid-cols-3 gap-3">
          <div>
            <p class="text-lg font-bold text-gray-900 dark:text-white">{{ store.eventWatchMetrics.webhookVolume }}</p>
            <p class="text-[10px] text-gray-500 dark:text-gray-400">Notify webhooks received</p>
          </div>
          <div>
            <p class="text-lg font-bold text-gray-900 dark:text-white">
              {{ store.eventWatchMetrics.avgRawEventsPerNotify !== null ? store.eventWatchMetrics.avgRawEventsPerNotify.toFixed(1) : "—" }}
            </p>
            <p class="text-[10px] text-gray-500 dark:text-gray-400">Avg. raw OS events collapsed per notify (debounce-collapse ratio)</p>
          </div>
          <div>
            <p class="text-lg font-bold text-gray-900 dark:text-white">{{ formatMs(store.eventWatchMetrics.avgLatencyMs) }}</p>
            <p class="text-[10px] text-gray-500 dark:text-gray-400">Avg. event-to-SOAR-reaction latency (median {{ formatMs(store.eventWatchMetrics.medianLatencyMs) }})</p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <button
          v-for="p in ['windows', 'macos']"
          :key="p"
          type="button"
          class="text-[11px] font-medium px-2.5 py-1 rounded-lg border"
          :class="platform === p ? 'text-white' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'"
          :style="platform === p ? { backgroundColor: PRIMARY_BLUE, borderColor: PRIMARY_BLUE } : {}"
          @click="platform = p as WatchPlatform; onPlatformChange()"
        >
          {{ p === "windows" ? "Windows" : "macOS" }}
        </button>
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
            @change="onWatchTypeChange"
            class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          >
            <option v-for="t in WATCH_TYPES_FOR_PLATFORM[platform]" :key="t" :value="t">{{ WATCH_TYPE_LABELS[t] }}</option>
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

        <template v-if="form.watchType === 'etwProvider'">
          <Input v-model="form.params.provider" label="Provider name or GUID" placeholder="Microsoft-Windows-Kernel-Process" :disabled="!canEdit()" />
          <div>
            <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">
              Event IDs (comma-separated, optional — blank matches every event from this provider)
            </label>
            <Input v-model="etwEventIdsText" placeholder="1,2" :disabled="!canEdit()" />
            <p class="text-[10px] text-gray-400 mt-1">For Microsoft-Windows-Kernel-Process: 1 = process start, 2 = process stop.</p>
          </div>
          <div>
            <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Level (0-255, optional — defaults to verbose)</label>
            <input
              type="number"
              v-model.number="form.params.level"
              min="0"
              max="255"
              :disabled="!canEdit()"
              class="w-28 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </template>

        <template v-if="form.watchType === 'fsEventsPath'">
          <Input v-model="form.params.path" label="File or folder path (absolute)" placeholder="/Library/Preferences/com.example.plist" :disabled="!canEdit()" />
          <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
            <input type="checkbox" v-model="form.params.recursive" :disabled="!canEdit()" /> Watch subdirectories too (recursive)
          </label>
          <p class="text-[10px] text-gray-400">
            Recursive watches only pick up subdirectories that exist when the agent starts watching — one created afterward
            isn't picked up until the agent restarts or re-syncs this watch.
          </p>
        </template>

        <template v-if="form.watchType === 'launchdJobState'">
          <Input v-model="form.params.label" label="Launchd job label" placeholder="com.crowdstrike.falcon.Agent" :disabled="!canEdit()" />
          <p class="text-[10px] text-gray-400">
            Fires when this job's loaded/running state changes — covers it loading, unloading, or crash-restarting.
          </p>
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
          <Button size="sm" :loading="isSaving" :disabled="!canEdit() || !form.name || paramsIncomplete" @click="save">{{ isEditing === "new" ? "Create" : "Save" }}</Button>
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
