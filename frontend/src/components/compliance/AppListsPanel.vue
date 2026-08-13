<script setup lang="ts">
// App Lists manager — the requiredAppList/disallowedAppList condition
// source. Group App Catalog entries into named lists that a Compliance
// Policy can reference. App Catalog management itself (search/add/remove
// entries) moved to the new top-level Apps view (AppCatalogPanel.vue) — this
// panel still reads store.appCatalog for the list editor's checkbox picker,
// it just no longer owns curating it, so this stays focused on App Lists +
// the installed-app inventory sync status instead of growing more crowded
// every time another app gets cataloged.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type AppList } from "../../stores/compliance";

const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const store = useComplianceStore();
const router = useRouter();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };
const platformOptions = [
  { value: "apple", label: "Apple (iOS/iPadOS)" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];

const listForm = reactive({ name: "", platform: "apple", appIds: [] as string[] });
const editingListId = ref<string | null>(null);
const listError = ref<string | null>(null);

// Which Compliance Policies reference each App List, via the
// requiredAppList/disallowedAppList condition types.
const referencingPolicies = computed(() => {
  const map: Record<string, string[]> = {};
  for (const p of store.policies) {
    for (const c of p.conditions ?? []) {
      if ((c.field === "requiredAppList" || c.field === "disallowedAppList") && typeof c.value === "string" && c.value) {
        (map[c.value] ??= []).push(p.name);
      }
    }
  }
  return map;
});

onMounted(async () => {
  await Promise.all([store.fetchAppCatalog(), store.fetchAppLists(), store.fetchInstalledAppsStatus()]);
});

function startNewList() {
  editingListId.value = "__new__";
  listForm.name = "";
  listForm.platform = "apple";
  listForm.appIds = [];
  listError.value = null;
}

function editList(list: AppList) {
  editingListId.value = list.id;
  listForm.name = list.name;
  listForm.platform = list.platform;
  listForm.appIds = [...list.appIds];
  listError.value = null;
}

function toggleAppInList(entryId: string) {
  const idx = listForm.appIds.indexOf(entryId);
  if (idx >= 0) listForm.appIds.splice(idx, 1);
  else listForm.appIds.push(entryId);
}

async function saveList() {
  listError.value = null;
  try {
    if (editingListId.value === "__new__") {
      await store.createAppList({ name: listForm.name, platform: listForm.platform, appIds: listForm.appIds });
    } else if (editingListId.value) {
      await store.updateAppList(editingListId.value, { name: listForm.name, platform: listForm.platform, appIds: listForm.appIds });
    }
    editingListId.value = null;
  } catch (err: any) {
    listError.value = err?.response?.data?.detail || "Failed to save App List.";
  }
}

async function removeList(list: AppList) {
  if (!confirm(`Delete App List "${list.name}"?`)) return;
  try {
    await store.deleteAppList(list.id);
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Could not delete — it may still be referenced by a Compliance Policy.");
  }
}

// ── Installed-app inventory sync status ──
const isRefreshingInventory = ref(false);
const inventoryRefreshMessage = ref<string | null>(null);
const isEditingBudget = ref(false);
const budgetDraft = ref("");
const isSavingBudget = ref(false);
let inventoryPoll: ReturnType<typeof setInterval> | null = null;

function formatAgeMinutes(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

const coveragePct = computed(() => {
  const s = store.installedAppsStatus;
  if (!s || !s.targetDeviceCount) return 0;
  return Math.round((s.syncedCount / s.targetDeviceCount) * 100);
});
const coverageColor = computed(() => (coveragePct.value >= 90 ? SUCCESS : coveragePct.value >= 50 ? WARNING : DANGER));

async function refreshInventoryNow() {
  isRefreshingInventory.value = true;
  inventoryRefreshMessage.value = null;
  try {
    const queued = await store.refreshInstalledAppsNow();
    inventoryRefreshMessage.value = queued > 0 ? `Refresh started for ${queued} device(s)…` : "Nothing to refresh — no devices are in scope of an app-list policy yet.";
    let ticks = 0;
    if (inventoryPoll) clearInterval(inventoryPoll);
    inventoryPoll = setInterval(() => {
      ticks += 1;
      store.fetchInstalledAppsStatus();
      if (ticks >= 10 && inventoryPoll) clearInterval(inventoryPoll);
    }, 3000);
  } catch (err: any) {
    inventoryRefreshMessage.value = err?.response?.data?.detail || "Could not start refresh.";
  } finally {
    isRefreshingInventory.value = false;
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
    await store.setInstalledAppsBudget(parsed);
    isEditingBudget.value = false;
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Could not update refresh budget.");
  } finally {
    isSavingBudget.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Installed-app inventory sync status -->
    <Alert v-if="store.installedAppsStatusError" type="danger">{{ store.installedAppsStatusError }}</Alert>
    <p v-else-if="!store.installedAppsStatus" class="text-xs text-gray-400">Loading inventory sync status…</p>
    <Alert v-else-if="store.installedAppsStatus.targetDeviceCount === 0" type="info">
      No enabled Compliance Policy uses a "Missing a required app" / "Has a disallowed app" condition yet — the installed-app inventory refresher stays idle until one does.
    </Alert>
    <div v-else class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm max-w-3xl">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1.5">
          <component :is="ICONS.Gauge" :size="14" weight="Linear" class="text-gray-400" />
          <h3 class="text-xs font-semibold text-gray-900 dark:text-white">Installed-app inventory sync</h3>
        </div>
        <Button size="sm" variant="secondary" :loading="isRefreshingInventory" @click="refreshInventoryNow">
          <component :is="ICONS.Refresh" :size="11" weight="Linear" :class="isRefreshingInventory ? 'animate-spin' : ''" /> Refresh now
        </Button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-2">
        <div>
          <div class="text-lg font-bold" :style="{ color: coverageColor }">{{ coveragePct }}%</div>
          <div class="text-[10px] text-gray-400">{{ store.installedAppsStatus.syncedCount }}/{{ store.installedAppsStatus.targetDeviceCount }} devices synced</div>
        </div>
        <div>
          <div class="text-lg font-bold" :style="{ color: SUCCESS }">{{ store.installedAppsStatus.selfReportedCount || 0 }}</div>
          <div class="text-[10px] text-gray-400">self-reported (free)</div>
        </div>
        <div>
          <div class="text-lg font-bold text-gray-900 dark:text-white">{{ formatAgeMinutes(store.installedAppsStatus.oldestSyncAgeMinutes) || "—" }}</div>
          <div class="text-[10px] text-gray-400">oldest sync age</div>
        </div>
        <div>
          <div class="text-lg font-bold" :class="store.installedAppsStatus.estimatedFullCycleHours > 6 ? '' : 'text-gray-900 dark:text-white'" :style="store.installedAppsStatus.estimatedFullCycleHours > 6 ? { color: WARNING } : {}">
            {{ store.installedAppsStatus.estimatedFullCycleHours }}h
          </div>
          <div class="text-[10px] text-gray-400">est. refresher cycle (excl. self-reported)</div>
        </div>
        <div>
          <div class="text-lg font-bold text-gray-900 dark:text-white">{{ store.installedAppsStatus.errorCount }}</div>
          <div class="text-[10px] text-gray-400">device(s) with fetch errors</div>
        </div>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
        <p class="text-[10px] flex items-center gap-1 text-gray-400">
          <component :is="ICONS.ClockCircle" :size="10" weight="Linear" />
          Refreshed in the background, stalest devices first —
          {{ store.installedAppsStatus.neverSyncedCount > 0 ? `${store.installedAppsStatus.neverSyncedCount} device(s) awaiting first sync.` : "every target device has synced at least once." }}
        </p>
        <div v-if="isEditingBudget" class="flex items-center gap-1.5">
          <input
            v-model="budgetDraft"
            type="number"
            :min="store.installedAppsStatus.refreshBudgetMin"
            :max="store.installedAppsStatus.refreshBudgetMax"
            class="w-20 px-2 py-1 rounded-md text-[11px] outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          />
          <button :disabled="isSavingBudget" class="text-[10px] px-2 py-1 rounded-md font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50" @click="saveBudget">Save</button>
          <button class="text-[10px] px-1.5 py-1 text-gray-400" @click="isEditingBudget = false">Cancel</button>
        </div>
        <button v-else class="text-[10px] flex items-center gap-1 hover:opacity-70 text-gray-400" @click="budgetDraft = String(store.installedAppsStatus.refreshBudgetPerHour); isEditingBudget = true">
          <component :is="ICONS.Pen" :size="9" weight="Linear" />
          Budget: {{ store.installedAppsStatus.refreshBudgetPerHour }} req/hour ({{ store.installedAppsStatus.refreshBudgetMin }}–{{ store.installedAppsStatus.refreshBudgetMax }})
        </button>
      </div>

      <p v-if="inventoryRefreshMessage" class="text-[10px] mt-2 text-gray-400">{{ inventoryRefreshMessage }}</p>
    </div>

    <section class="space-y-3 max-w-2xl">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">App Lists</p>
        <div class="flex items-center gap-2">
          <button type="button" class="text-[11px] flex items-center gap-1 text-gray-400 hover:opacity-70" @click="router.push({ name: 'apps' })">
            <component :is="ICONS.Box" :size="11" weight="Linear" /> Manage App Catalog
          </button>
          <Button size="sm" variant="secondary" @click="startNewList">New list</Button>
        </div>
      </div>

      <div v-if="editingListId" class="border border-brand-200 bg-brand-50 rounded-xl p-3 space-y-2">
        <Alert v-if="listError" type="danger">{{ listError }}</Alert>
        <Input v-model="listForm.name" placeholder="List name" />
        <!-- Platform is locked once a list is created — its appIds are platform-scoped. -->
        <Input v-model="listForm.platform" type="select" :options="platformOptions" :disabled="editingListId !== '__new__'" />
        <div v-if="store.appCatalog.filter((e) => e.platform === listForm.platform).length === 0" class="text-xs px-2 py-2 rounded-lg bg-white dark:bg-gray-800 text-gray-400">
          No {{ PLATFORM_LABELS[listForm.platform] || listForm.platform }} apps in the catalog yet —
          <button type="button" class="underline hover:opacity-70" @click="router.push({ name: 'apps' })">add some from the Apps page</button> first.
        </div>
        <div v-else class="max-h-32 overflow-y-auto space-y-1 border border-white/60 rounded-lg p-2 bg-white dark:bg-gray-800">
          <label v-for="entry in store.appCatalog.filter((e) => e.platform === listForm.platform)" :key="entry.id" class="flex items-center gap-2 text-sm">
            <input type="checkbox" :checked="listForm.appIds.includes(entry.id)" @change="toggleAppInList(entry.id)" />
            {{ entry.name || entry.identifier }}
          </label>
        </div>
        <div class="flex gap-2">
          <Button size="sm" @click="saveList">Save list</Button>
          <Button size="sm" variant="ghost" @click="editingListId = null">Cancel</Button>
        </div>
      </div>

      <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
        <div v-for="list in store.appLists" :key="list.id" class="flex items-center justify-between px-3 py-2 text-sm">
          <div>
            <p class="text-gray-900 dark:text-white">{{ list.name }}</p>
            <p class="text-xs text-gray-400">
              {{ PLATFORM_LABELS[list.platform] || list.platform }} · {{ list.appIds.length }} app(s)
              <template v-if="referencingPolicies[list.id]?.length"> · used by {{ referencingPolicies[list.id].length }} polic{{ referencingPolicies[list.id].length === 1 ? "y" : "ies" }}</template>
            </p>
          </div>
          <div class="space-x-1">
            <Button size="sm" variant="secondary" @click="editList(list)">Edit</Button>
            <Button size="sm" variant="ghost" @click="removeList(list)">Delete</Button>
          </div>
        </div>
        <p v-if="store.appLists.length === 0" class="text-xs text-gray-400 px-3 py-3">No App Lists yet.</p>
      </div>
    </section>
  </div>
</template>
