<script setup lang="ts">
// Port of DeviceAudienceCreateModal (DevicePickers.jsx:296-425) — creates a
// Device Audience from grouped device/employee tags (OR-within-group,
// AND-across-groups), explicit serial numbers, hand-picked devices, and
// hand-picked employees. Used by AudiencePickerField's "New" button, both
// from a compliance condition row and the Policy Builder's "Apply to
// devices" section.
import { Modal } from "@applivery/bluesky-vue";
import { onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore } from "../../stores/devices";

const PRIMARY_BLUE = "#0241E3";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [audience: { id: string; name: string }] }>();

const devicesStore = useDevicesStore();

const name = ref("");
const description = ref("");
const deviceTags = ref<string[]>([]);
const employeeTags = ref<string[]>([]);
const deviceTagGroups = ref<string[][]>([]);
const employeeTagGroups = ref<string[][]>([]);
const serialDraft = ref("");
const serials = ref<string[]>([]);
const allDevices = ref<any[]>([]);
const deviceSearch = ref("");
const selectedDeviceIds = ref<string[]>([]);
const employeeSearch = ref("");
const employeeResults = ref<Array<{ id: string; name?: string; email?: string }>>([]);
const selectedEmployees = ref<Array<{ id: string; label: string }>>([]);
const isSaving = ref(false);
const error = ref<string | null>(null);

function reset() {
  name.value = "";
  description.value = "";
  deviceTagGroups.value = [];
  employeeTagGroups.value = [];
  serials.value = [];
  serialDraft.value = "";
  selectedDeviceIds.value = [];
  employeeSearch.value = "";
  employeeResults.value = [];
  selectedEmployees.value = [];
  error.value = null;
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    reset();
    const { api } = await import("../../api/http");
    api.get("/device-tags").then((res) => (deviceTags.value = res.data?.items ?? [])).catch(() => {});
    api.get("/mdm-user-tags").then((res) => (employeeTags.value = res.data?.items ?? [])).catch(() => {});
    api.get("/devices").then((res) => (allDevices.value = res.data?.items ?? [])).catch(() => {});
  },
  { immediate: true },
);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(employeeSearch, (term) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = term.trim();
  if (!trimmed) {
    employeeResults.value = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    const { api } = await import("../../api/http");
    try {
      const res = await api.get("/mdm-users", { params: { search: trimmed } });
      employeeResults.value = res.data?.items ?? [];
    } catch {
      employeeResults.value = [];
    }
  }, 300);
});

function addGroup(groups: string[][]) {
  groups.push([]);
}
function removeGroup(groups: string[][], i: number) {
  groups.splice(i, 1);
}
function toggleInGroup(groups: string[][], i: number, tag: string) {
  const g = groups[i];
  const idx = g.indexOf(tag);
  if (idx >= 0) g.splice(idx, 1);
  else g.push(tag);
}

function addSerial() {
  const v = serialDraft.value.trim();
  if (v && !serials.value.includes(v)) serials.value.push(v);
  serialDraft.value = "";
}

function toggleDevice(id: string) {
  const idx = selectedDeviceIds.value.indexOf(id);
  if (idx >= 0) selectedDeviceIds.value.splice(idx, 1);
  else selectedDeviceIds.value.push(id);
}

function toggleEmployee(u: { id: string; name?: string; email?: string }) {
  const idx = selectedEmployees.value.findIndex((e) => e.id === u.id);
  if (idx >= 0) selectedEmployees.value.splice(idx, 1);
  else selectedEmployees.value.push({ id: u.id, label: u.name || u.email || u.id });
}

function filteredDevices() {
  const term = deviceSearch.value.trim().toLowerCase();
  if (!term) return allDevices.value.slice(0, 25);
  return allDevices.value.filter((d) => (d.displayName || "").toLowerCase().includes(term) || (d.serialNumber || "").toLowerCase().includes(term));
}

async function handleCreate() {
  if (!name.value.trim()) {
    error.value = "Give the audience a name.";
    return;
  }
  isSaving.value = true;
  error.value = null;

  const selected = allDevices.value.filter((d) => selectedDeviceIds.value.includes(d.id));
  const byPlatform: Record<string, string[]> = { emmDeviceIds: [], admDeviceIds: [], winDeviceIds: [], aosDeviceIds: [] };
  for (const d of selected) {
    const pid = d.platformDeviceId || d.id;
    if (d.platform === "android") byPlatform.emmDeviceIds.push(pid);
    else if (d.platform === "apple" || d.platform === "macos") byPlatform.admDeviceIds.push(pid);
    else if (d.platform === "windows") byPlatform.winDeviceIds.push(pid);
  }

  try {
    const { api } = await import("../../api/http");
    const res = await api.post("/device-audiences", {
      name: name.value.trim(),
      description: description.value.trim() || null,
      selectors: {
        deviceGroups: deviceTagGroups.value.filter((g) => g.length > 0),
        mdmUserGroups: employeeTagGroups.value.filter((g) => g.length > 0),
        serialNumbers: serials.value,
        mdmUserIds: selectedEmployees.value.map((e) => e.id),
        ...byPlatform,
      },
    });
    emit("created", res.data);
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to create the audience.";
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => {
  if (devicesStore.deviceTags.length === 0) devicesStore.fetchPickers();
});
</script>

<template>
  <Modal :open="open" title="Create Device Audience" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <div v-if="error" class="px-3 py-2 rounded-lg text-xs font-medium border" style="background-color: #ef444412; color: #ef4444; border-color: #ef444430">{{ error }}</div>

      <div class="space-y-2">
        <input v-model="name" autofocus placeholder="Audience name, e.g. EU Sales Fleet" class="w-full px-3 py-2 rounded-lg text-sm font-medium outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
        <textarea v-model="description" placeholder="Description (optional)" rows="2" class="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
      </div>

      <div v-for="(cfg, ci) in [
        { label: 'Device tags', available: deviceTags, groups: deviceTagGroups, empty: 'No device tags found in the fleet yet.' },
        { label: 'Employee tags', available: employeeTags, groups: employeeTagGroups, empty: 'No employee tags found yet.' },
      ]" :key="ci">
        <div class="flex items-center justify-between mb-1.5">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{{ cfg.label }}</p>
          <button type="button" class="inline-flex items-center gap-1 text-[11px] font-medium" :style="{ color: PRIMARY_BLUE }" @click="addGroup(cfg.groups)">
            <component :is="ICONS.AddSquare" :size="11" weight="Linear" /> Add group
          </button>
        </div>
        <p v-if="cfg.groups.length === 0" class="text-[11px] text-gray-400">No groups — device match isn't limited by {{ cfg.label.toLowerCase() }}.</p>
        <div class="space-y-2">
          <div v-for="(g, gi) in cfg.groups" :key="gi" class="rounded-lg p-2 border border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[10px] font-semibold text-gray-400">Group {{ gi + 1 }} (OR)</span>
              <button type="button" style="color: #ef4444" @click="removeGroup(cfg.groups, gi)">
                <component :is="ICONS.TrashBinMinimalistic" :size="11" weight="Linear" />
              </button>
            </div>
            <p v-if="cfg.available.length === 0" class="text-[11px] text-gray-400">{{ cfg.empty }}</p>
            <div v-else class="flex flex-wrap gap-1.5">
              <button
                v-for="opt in cfg.available"
                :key="opt"
                type="button"
                class="px-2 py-1 rounded-md text-[11px] font-medium transition-colors border"
                :style="g.includes(opt) ? { backgroundColor: `${PRIMARY_BLUE}18`, color: PRIMARY_BLUE, borderColor: PRIMARY_BLUE } : { color: '#9CA3AF', borderColor: '#E5E7EB' }"
                @click="toggleInGroup(cfg.groups, gi, opt)"
              >
                {{ opt }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Serial numbers</p>
        <div class="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
          <span v-for="s in serials" :key="s" class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
            {{ s }}
            <button class="hover:opacity-60" @click="serials = serials.filter((x) => x !== s)"><component :is="ICONS.CloseCircle" :size="10" weight="Linear" /></button>
          </span>
          <span v-if="serials.length === 0" class="text-[11px] text-gray-400">None added</span>
        </div>
        <div class="flex items-center gap-2">
          <input v-model="serialDraft" placeholder="Serial number, press Enter…" class="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" @keydown.enter.prevent="addSerial" />
          <button class="p-1.5 rounded-lg text-white shrink-0 bg-brand-600 hover:bg-brand-700" @click="addSerial"><component :is="ICONS.AddSquare" :size="13" weight="Linear" /></button>
        </div>
      </div>

      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.Smartphone" :size="11" weight="Linear" /> Add devices {{ selectedDeviceIds.length > 0 ? `(${selectedDeviceIds.length} selected)` : "" }}
        </p>
        <input v-model="deviceSearch" placeholder="Search devices by name or serial…" class="w-full px-2 py-1.5 rounded-lg text-xs outline-none mb-1.5 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
        <div class="max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <label v-for="d in filteredDevices()" :key="d.id" class="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer border-b border-gray-100 dark:border-gray-800 last:border-0">
            <input type="checkbox" :checked="selectedDeviceIds.includes(d.id)" @change="toggleDevice(d.id)" />
            <span class="truncate">{{ d.displayName }}</span>
            <span class="ml-auto text-[10px] shrink-0 text-gray-400">{{ d.platformLabel || d.platform }}</span>
          </label>
          <p v-if="filteredDevices().length === 0" class="text-[11px] text-center py-3 text-gray-400">No devices match.</p>
        </div>
      </div>

      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.UsersGroupRounded" :size="11" weight="Linear" /> Add employees {{ selectedEmployees.length > 0 ? `(${selectedEmployees.length} selected)` : "" }}
        </p>
        <div class="flex flex-wrap gap-1.5 mb-1.5">
          <span v-for="e in selectedEmployees" :key="e.id" class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
            {{ e.label }}
            <button class="hover:opacity-60" @click="selectedEmployees = selectedEmployees.filter((x) => x.id !== e.id)"><component :is="ICONS.CloseCircle" :size="10" weight="Linear" /></button>
          </span>
        </div>
        <input v-model="employeeSearch" placeholder="Search employees by name or email…" class="w-full px-2 py-1.5 rounded-lg text-xs outline-none mb-1.5 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
        <div v-if="employeeResults.length > 0" class="max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <label v-for="u in employeeResults" :key="u.id" class="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer border-b border-gray-100 dark:border-gray-800 last:border-0">
            <input type="checkbox" :checked="selectedEmployees.some((e) => e.id === u.id)" @change="toggleEmployee(u)" />
            <span class="truncate">{{ u.name }}</span>
            <span class="ml-auto text-[10px] truncate text-gray-400">{{ u.email }}</span>
          </label>
        </div>
      </div>
    </div>
    <div class="flex gap-3 justify-end pt-4">
      <button class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('close')">Cancel</button>
      <button :disabled="isSaving" class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50" @click="handleCreate">
        {{ isSaving ? "Creating…" : "Create audience" }}
      </button>
    </div>
  </Modal>
</template>
