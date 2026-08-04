<script setup lang="ts">
// Geofence zone management modal — list every saved zone, edit its
// name/description/color (NOT its geometry; redraw + delete-old is the
// supported way to change a zone's shape, kept simple deliberately since
// this app doesn't have drag-to-reshape editing on the map), and delete.
// Reached from PlaygroundMapView.vue's "Manage Zones" toolbar button.
import { Modal } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useGeofencingStore, type GeofenceZone } from "../../stores/geofencing";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";
const DEFAULT_COLOR = "#0241E3";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useGeofencingStore();
const editingId = ref<string | null>(null);
const editForm = reactive({ name: "", description: "", color: DEFAULT_COLOR });
const isSaving = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
  if (store.zones.length === 0) store.fetchZones();
  store.fetchRefreshStatus();
});

// ── Device-location background refresh status — mirrors the Installed-app
// inventory sync block in AppListsPanel.vue (same budgeted, oldest-first
// background refresher shape; see locationsRefresh.service.ts). Lives here
// rather than in a generic Settings screen because this modal is already
// the geofencing asset-management surface, same reasoning as why the
// installed-app sync status lives inside AppListsPanel rather than Settings.
const isRefreshingLocations = ref(false);
const refreshMessage = ref<string | null>(null);
const isEditingBudget = ref(false);
const budgetDraft = ref("");
const isSavingBudget = ref(false);
let statusPoll: ReturnType<typeof setInterval> | null = null;

function formatAgeMinutes(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

const coveragePct = computed(() => {
  const s = store.refreshStatus;
  if (!s || !s.targetDeviceCount) return 0;
  return Math.round((s.syncedCount / s.targetDeviceCount) * 100);
});
const coverageColor = computed(() => (coveragePct.value >= 90 ? SUCCESS : coveragePct.value >= 50 ? WARNING : DANGER));

async function refreshLocationsNow() {
  isRefreshingLocations.value = true;
  refreshMessage.value = null;
  try {
    const { queued } = await store.refreshLocationsNow();
    refreshMessage.value = queued > 0 ? `Refresh started for ${queued} device(s)…` : "Nothing to refresh — no devices are scoped by a geofence policy condition yet.";
    let ticks = 0;
    if (statusPoll) clearInterval(statusPoll);
    statusPoll = setInterval(() => {
      ticks += 1;
      store.fetchRefreshStatus();
      if (ticks >= 10 && statusPoll) clearInterval(statusPoll);
    }, 3000);
  } catch (err: any) {
    refreshMessage.value = err?.response?.data?.detail || "Could not start refresh.";
  } finally {
    isRefreshingLocations.value = false;
  }
}

async function saveBudget() {
  const parsed = parseInt(budgetDraft.value, 10);
  if (!parsed || Number.isNaN(parsed)) {
    isEditingBudget.value = false;
    return;
  }
  isSavingBudget.value = true;
  try {
    await store.setRefreshBudget(parsed);
    isEditingBudget.value = false;
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Could not update refresh budget.");
  } finally {
    isSavingBudget.value = false;
  }
}

function startEdit(zone: GeofenceZone) {
  editingId.value = zone.id;
  editForm.name = zone.name;
  editForm.description = zone.description ?? "";
  editForm.color = zone.color ?? DEFAULT_COLOR;
  error.value = null;
}

function cancelEdit() {
  editingId.value = null;
  error.value = null;
}

async function saveEdit(zone: GeofenceZone) {
  if (!editForm.name.trim()) {
    error.value = "Give this zone a name.";
    return;
  }
  isSaving.value = true;
  error.value = null;
  try {
    await store.updateZone(zone.id, { name: editForm.name.trim(), description: editForm.description.trim() || null, shape: zone.shape, geometry: zone.geometry, color: editForm.color });
    editingId.value = null;
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to save zone.";
  } finally {
    isSaving.value = false;
  }
}

async function remove(zone: GeofenceZone) {
  if (!confirm(`Delete geofence zone "${zone.name}"? Any Compliance Policy condition referencing it will stop matching any device.`)) return;
  await store.deleteZone(zone.id);
}

function shapeSummary(zone: GeofenceZone): string {
  if (zone.shape === "circle") {
    const r = zone.geometry.radiusMeters ?? 0;
    return r >= 1000 ? `Circle, ${(r / 1000).toFixed(1)} km radius` : `Circle, ${Math.round(r)} m radius`;
  }
  return `Polygon, ${zone.geometry.points?.length ?? 0} points`;
}
</script>

<template>
  <Modal :open="open" size="md" class="max-w-xl" @close="emit('close')">
    <div class="flex items-center justify-between gap-2 mb-4 -mt-1">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Geofence Zones</h3>
        <p class="text-xs mt-0.5 text-gray-400">Zones drawn on the map, usable as Compliance Policy conditions ("device inside/outside").</p>
      </div>
      <button class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 shrink-0" @click="emit('close')">
        <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
      </button>
    </div>

    <!-- Device-location background refresh status -->
    <div v-if="store.refreshStatusError" class="mb-3 px-3 py-2 rounded-lg text-xs font-medium" style="background-color: #ef444412; color: #ef4444; border: 1px solid #ef444430">{{ store.refreshStatusError }}</div>
    <p v-else-if="!store.refreshStatus" class="text-xs text-gray-400 mb-3">Loading location refresh status…</p>
    <div v-else-if="store.refreshStatus.targetDeviceCount === 0" class="mb-3 px-3 py-2 rounded-lg text-xs" style="background-color: #0241e312; color: #0241E3; border: 1px solid #0241e330">
      No enabled Compliance Policy uses an "inside/outside geofence zone" condition yet — the location refresher stays idle until one does.
    </div>
    <div v-else class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 mb-4">
      <div class="flex items-center justify-between mb-2.5">
        <div class="flex items-center gap-1.5">
          <component :is="ICONS.Gauge" :size="13" weight="Linear" class="text-gray-400" />
          <h4 class="text-[11px] font-semibold text-gray-900 dark:text-white">Device-location refresh</h4>
        </div>
        <button class="text-[10px] font-semibold px-2 py-1 rounded-md flex items-center gap-1 disabled:opacity-50" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }" :disabled="isRefreshingLocations" @click="refreshLocationsNow">
          <component :is="ICONS.Refresh" :size="10" weight="Linear" :class="isRefreshingLocations ? 'animate-spin' : ''" /> Refresh now
        </button>
      </div>

      <div class="grid grid-cols-4 gap-2 mb-2">
        <div>
          <div class="text-sm font-bold" :style="{ color: coverageColor }">{{ coveragePct }}%</div>
          <div class="text-[9px] text-gray-400">{{ store.refreshStatus.syncedCount }}/{{ store.refreshStatus.targetDeviceCount }} synced</div>
        </div>
        <div>
          <div class="text-sm font-bold text-gray-900 dark:text-white">{{ formatAgeMinutes(store.refreshStatus.oldestSyncAgeMinutes) || "—" }}</div>
          <div class="text-[9px] text-gray-400">oldest sync age</div>
        </div>
        <div>
          <div class="text-sm font-bold" :style="store.refreshStatus.estimatedFullCycleHours > 6 ? { color: WARNING } : {}">{{ store.refreshStatus.estimatedFullCycleHours }}h</div>
          <div class="text-[9px] text-gray-400">est. full cycle</div>
        </div>
        <div>
          <div class="text-sm font-bold text-gray-900 dark:text-white">{{ store.refreshStatus.errorCount }}</div>
          <div class="text-[9px] text-gray-400">fetch errors</div>
        </div>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
        <p class="text-[9px] flex items-center gap-1 text-gray-400">
          <component :is="ICONS.ClockCircle" :size="9" weight="Linear" />
          {{ store.refreshStatus.neverSyncedCount > 0 ? `${store.refreshStatus.neverSyncedCount} device(s) awaiting first sync.` : "every scoped device has synced at least once." }}
        </p>
        <div v-if="isEditingBudget" class="flex items-center gap-1.5">
          <input
            v-model="budgetDraft"
            type="number"
            :min="store.refreshStatus.refreshBudgetMin"
            :max="store.refreshStatus.refreshBudgetMax"
            class="w-16 px-1.5 py-1 rounded-md text-[10px] outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          />
          <button :disabled="isSavingBudget" class="text-[9px] px-1.5 py-1 rounded-md font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50" @click="saveBudget">Save</button>
          <button class="text-[9px] px-1 py-1 text-gray-400" @click="isEditingBudget = false">Cancel</button>
        </div>
        <button v-else class="text-[9px] flex items-center gap-1 hover:opacity-70 text-gray-400" @click="budgetDraft = String(store.refreshStatus.refreshBudgetPerHour); isEditingBudget = true">
          <component :is="ICONS.Pen" :size="8" weight="Linear" />
          Budget: {{ store.refreshStatus.refreshBudgetPerHour }} req/hour ({{ store.refreshStatus.refreshBudgetMin }}–{{ store.refreshStatus.refreshBudgetMax }})
        </button>
      </div>

      <p v-if="refreshMessage" class="text-[9px] mt-2 text-gray-400">{{ refreshMessage }}</p>
    </div>

    <div v-if="store.zonesError" class="mb-3 px-3 py-2 rounded-lg text-xs font-medium" style="background-color: #ef444412; color: #ef4444; border: 1px solid #ef444430">{{ store.zonesError }}</div>
    <p v-if="store.isLoadingZones" class="text-xs text-gray-400">Loading zones…</p>
    <p v-else-if="!store.zones.length" class="text-xs text-gray-400 py-6 text-center">No zones yet — draw one from the Map View toolbar.</p>

    <div class="max-h-[55vh] overflow-y-auto space-y-2">
      <div v-for="z in store.zones" :key="z.id" class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <template v-if="editingId === z.id">
          <div class="space-y-2">
            <input v-model="editForm.name" placeholder="Zone name" class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" />
            <textarea v-model="editForm.description" placeholder="Description (optional)" rows="2" class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" />
            <div class="flex items-center gap-2">
              <input v-model="editForm.color" type="color" class="w-8 h-8 rounded cursor-pointer border border-gray-200 dark:border-gray-700" />
              <span class="text-[10px] text-gray-400">Overlay color</span>
            </div>
            <p v-if="error" class="text-[10px]" style="color: #ef4444">{{ error }}</p>
            <div class="flex items-center gap-2 justify-end">
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="cancelEdit">Cancel</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" :style="{ backgroundColor: PRIMARY_BLUE }" :disabled="isSaving" @click="saveEdit(z)">{{ isSaving ? "Saving…" : "Save" }}</button>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex items-start gap-2">
              <span class="w-3 h-3 rounded-full mt-0.5 shrink-0 border border-white/40" :style="{ backgroundColor: z.color || DEFAULT_COLOR }" />
              <div class="min-w-0">
                <p class="text-sm font-semibold truncate text-gray-900 dark:text-white">{{ z.name }}</p>
                <p class="text-xs text-gray-400">{{ shapeSummary(z) }}</p>
                <p v-if="z.description" class="text-xs mt-1 text-gray-400 line-clamp-2">{{ z.description }}</p>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button class="p-1.5 rounded-lg text-gray-700 dark:text-gray-200" title="Edit name/description/color" @click="startEdit(z)">
                <component :is="ICONS.Pen" :size="13" weight="Linear" />
              </button>
              <button class="p-1.5 rounded-lg" :style="{ color: DANGER }" title="Delete zone" @click="remove(z)">
                <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Modal>
</template>
