<script setup lang="ts">
// App Lists / App Catalog manager — the requiredAppList/disallowedAppList
// condition source. Search live catalogs (App Store/MS Store/winget/
// Homebrew/Android known-apps) to add an entry without knowing the bundle
// id/package name by heart, then group entries into named lists.
//
// Structural note: the original (AppListsView.jsx) embeds search/presets/
// manual-entry *inside* each list's own edit form (AppListForm), so search
// is always scoped to whichever platform that draft list is on. Here the
// App Catalog (left) is a standalone panel independent of the list editor
// (right) — you search/add to the shared catalog once, then any list on
// that platform can pick from it. Same end capability (search a live
// catalog, add manually, group into named lists), different layout; no
// original AppListForm capability is otherwise dropped — quick-start
// presets, the multi-source picker (Apple Store/Homebrew/MS Store/Winget/
// Android known-apps), the 4-character debounced live search, and the
// installed-app inventory sync panel are all present below.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type AppCatalogEntry, type AppList } from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const store = useComplianceStore();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };
const platformOptions = [
  { value: "apple", label: "Apple (iOS/iPadOS)" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];

// Mirrors SEARCH_SOURCES_BY_PLATFORM in appSearch.service.ts — first entry
// per platform is the default source shown when that platform is selected
// (AppListsView.jsx:26-31).
const SOURCES_BY_PLATFORM: Record<string, Array<{ id: string; label: string }>> = {
  apple: [{ id: "apple_store", label: "Apple App Store" }],
  macos: [
    { id: "apple_store", label: "Apple App Store" },
    { id: "homebrew", label: "Homebrew (Cask)" },
  ],
  windows: [
    { id: "ms_store", label: "Microsoft Store" },
    { id: "winget", label: "Winget" },
  ],
  android: [{ id: "android_known", label: "Known Apps" }],
};

// Curated starting points — convenience seed, not an authority (spot-check
// before relying on it for enforcement). Windows deliberately omitted, same
// as the original (AppListsView.jsx:35-70) — no identifier convention
// confident enough to hardcode.
const PRESETS: Record<string, Array<{ label: string; apps: Array<{ identifier: string; name: string }> }>> = {
  apple: [
    { label: "Common browsers", apps: [
      { identifier: "com.apple.mobilesafari", name: "Safari" },
      { identifier: "com.google.chrome.ios", name: "Chrome" },
      { identifier: "org.mozilla.ios.Firefox", name: "Firefox" },
    ] },
    { label: "Collaboration apps", apps: [
      { identifier: "com.tinyspeck.chatlyio", name: "Slack" },
      { identifier: "us.zoom.videomeetings", name: "Zoom" },
      { identifier: "com.microsoft.skype.teams", name: "Microsoft Teams" },
    ] },
  ],
  macos: [
    { label: "Common browsers", apps: [
      { identifier: "com.apple.Safari", name: "Safari" },
      { identifier: "com.google.Chrome", name: "Chrome" },
      { identifier: "org.mozilla.firefox", name: "Firefox" },
    ] },
    { label: "Collaboration apps", apps: [
      { identifier: "com.tinyspeck.slackmacgap", name: "Slack" },
      { identifier: "us.zoom.xos", name: "Zoom" },
      { identifier: "com.microsoft.teams2", name: "Microsoft Teams" },
    ] },
  ],
  android: [
    { label: "Common browsers", apps: [
      { identifier: "com.android.chrome", name: "Chrome" },
      { identifier: "org.mozilla.firefox", name: "Firefox" },
    ] },
    { label: "Collaboration apps", apps: [
      { identifier: "com.slack", name: "Slack" },
      { identifier: "us.zoom.videomeetings", name: "Zoom" },
      { identifier: "com.microsoft.teams", name: "Microsoft Teams" },
    ] },
  ],
};

const searchPlatform = ref("apple");
const searchSource = ref(SOURCES_BY_PLATFORM.apple[0].id);
const searchQuery = ref("");
const searchResults = ref<Array<{ identifier: string; name: string; iconUrl?: string; source?: string }>>([]);
const isSearching = ref(false);
const searchError = ref<string | null>(null);
const sources = computed(() => SOURCES_BY_PLATFORM[searchPlatform.value] || []);

// Switching platform invalidates whatever was mid-search — reset source to
// that platform's default and clear stale results (AppListsView.jsx:108-113).
watch(searchPlatform, (platform) => {
  searchSource.value = (SOURCES_BY_PLATFORM[platform] || [])[0]?.id ?? "";
  searchQuery.value = "";
  searchResults.value = [];
  searchError.value = null;
});

// Live search, debounced, 4+ characters — matches AppListsView.jsx:115-131.
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch([searchQuery, searchSource], () => {
  if (searchTimer) clearTimeout(searchTimer);
  if (searchQuery.value.trim().length < 4 || !searchSource.value) {
    searchResults.value = [];
    searchError.value = null;
    isSearching.value = false;
    return;
  }
  isSearching.value = true;
  searchError.value = null;
  searchTimer = setTimeout(async () => {
    try {
      const res = await store.searchApps(searchPlatform.value, searchQuery.value.trim(), searchSource.value);
      searchResults.value = res.items;
      searchError.value = res.error;
    } catch (err: any) {
      searchResults.value = [];
      searchError.value = err?.response?.data?.detail || err?.message || "Search failed — see server logs";
    } finally {
      isSearching.value = false;
    }
  }, 350);
});

// Manual entry — for anything the live catalog search can't find.
const manualName = ref("");
const manualIdentifier = ref("");
const catalogError = ref<string | null>(null);

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

async function addByIdentifier(identifier: string, name: string, iconUrl: string | null | undefined, source: string) {
  if (!identifier.trim()) return;
  catalogError.value = null;
  try {
    await store.addAppCatalogEntry({ platform: searchPlatform.value, identifier: identifier.trim(), name, iconUrl: iconUrl ?? undefined, source });
  } catch (err: any) {
    catalogError.value = err?.response?.data?.detail || err?.message || `Could not add "${name || identifier}"`;
  }
}

async function addPreset(preset: { apps: Array<{ identifier: string; name: string }> }) {
  catalogError.value = null;
  for (const app of preset.apps) {
    // eslint-disable-next-line no-await-in-loop
    await addByIdentifier(app.identifier, app.name, null, "preset");
  }
}

async function addManualEntry() {
  if (!manualName.value.trim() || !manualIdentifier.value.trim()) return;
  await addByIdentifier(manualIdentifier.value, manualName.value.trim(), null, "manual");
  manualName.value = "";
  manualIdentifier.value = "";
}

async function addToCatalog(item: { identifier: string; name: string; iconUrl?: string }) {
  await addByIdentifier(item.identifier, item.name, item.iconUrl, searchSource.value);
}

async function removeCatalogEntry(entry: AppCatalogEntry) {
  if (!confirm(`Remove "${entry.name || entry.identifier}" from the App Catalog?`)) return;
  try {
    await store.deleteAppCatalogEntry(entry.id);
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Could not remove — it may still be referenced by an App List.");
  }
}

function startNewList() {
  editingListId.value = "__new__";
  listForm.name = "";
  listForm.platform = searchPlatform.value;
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

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section class="space-y-3">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">App Catalog</p>
        <div class="flex items-center gap-2">
          <Input v-model="searchPlatform" type="select" :options="platformOptions" class="w-40" />
        </div>

        <div v-if="sources.length > 1" class="flex gap-1.5">
          <button
            v-for="s in sources"
            :key="s.id"
            type="button"
            class="text-[10px] px-2.5 py-1 rounded-md font-semibold transition-colors"
            :class="searchSource === s.id ? '' : 'border border-gray-200 dark:border-gray-700 text-gray-400'"
            :style="searchSource === s.id ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : {}"
            @click="searchSource = s.id"
          >
            {{ s.label }}
          </button>
        </div>

        <Input v-model="searchQuery" :placeholder="searchPlatform === 'android' ? 'App name (already-known Applivery apps only — see note below)' : 'Search apps… (4+ characters)'" />
        <p v-if="isSearching" class="text-[10px] text-gray-400">Searching…</p>
        <Alert v-if="searchError" type="danger">{{ searchError }}</Alert>
        <p v-if="!isSearching && !searchError && searchQuery.trim().length >= 4 && searchResults.length === 0" class="text-[10px] text-gray-400">
          No matches for "{{ searchQuery.trim() }}" on {{ sources.find((s) => s.id === searchSource)?.label || searchSource }}.
        </p>

        <div v-if="searchResults.length" class="space-y-1 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
          <div v-for="r in searchResults" :key="`${r.source}:${r.identifier}`" class="flex items-center justify-between text-sm px-1 py-1">
            <span class="truncate flex-1">{{ r.name }} <span class="text-[9px] text-gray-400">({{ r.identifier }})</span></span>
            <Button size="sm" variant="ghost" @click="addToCatalog(r)">Add</Button>
          </div>
        </div>

        <p v-if="searchPlatform === 'android'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          No free-text Play Store search exists for EMMs — results above are apps already known to your Applivery org (App Distribution catalog + Android Enterprise). Use manual entry below for anything else.
        </p>
        <p v-if="searchPlatform === 'windows' && searchSource === 'winget'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          Winget's community index — a convenience suggestion, not authoritative. Double-check a result before relying on it for enforcement.
        </p>
        <p v-if="searchPlatform === 'macos' && searchSource === 'homebrew'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          Homebrew casks have no bundle-ID field — these are name-only suggestions. Confirm the real bundle ID before relying on it.
        </p>

        <div v-if="PRESETS[searchPlatform]">
          <label class="block text-[10px] font-medium mb-1 text-gray-400">Quick-start presets</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in PRESETS[searchPlatform]"
              :key="preset.label"
              type="button"
              class="text-[10px] px-2 py-1 rounded-md font-medium"
              :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
              @click="addPreset(preset)"
            >
              + {{ preset.label }}
            </button>
          </div>
          <p v-if="catalogError" class="inline-flex items-start gap-1 text-[10px] mt-1.5" :style="{ color: DANGER }">
            <component :is="ICONS.DangerTriangle" :size="10" weight="Linear" class="shrink-0 mt-0.5" /> {{ catalogError }}
          </p>
        </div>

        <!-- Manual entry — not found via search? add it by hand. -->
        <details class="text-xs">
          <summary class="cursor-pointer font-medium text-gray-500 dark:text-gray-400 select-none">Can't find it? Add manually</summary>
          <div class="flex items-center gap-2 mt-2">
            <Input v-model="manualName" placeholder="App name" class="flex-1" />
            <Input v-model="manualIdentifier" placeholder="Bundle ID / package name" class="flex-1" />
            <Button size="sm" variant="secondary" :disabled="!manualName.trim() || !manualIdentifier.trim()" @click="addManualEntry">Add</Button>
          </div>
        </details>

        <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
          <div v-for="entry in store.appCatalog" :key="entry.id" class="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <p class="text-gray-900 dark:text-white">{{ entry.name || entry.identifier }}</p>
              <p class="text-xs text-gray-400">{{ PLATFORM_LABELS[entry.platform] || entry.platform }} · {{ entry.identifier }}</p>
            </div>
            <Button size="sm" variant="ghost" @click="removeCatalogEntry(entry)">Remove</Button>
          </div>
          <p v-if="store.appCatalog.length === 0" class="text-xs text-gray-400 px-3 py-3">No catalog entries yet — search above to add one.</p>
        </div>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-gray-900 dark:text-white">App Lists</p>
          <Button size="sm" variant="secondary" @click="startNewList">New list</Button>
        </div>

        <div v-if="editingListId" class="border border-brand-200 bg-brand-50 rounded-xl p-3 space-y-2">
          <Alert v-if="listError" type="danger">{{ listError }}</Alert>
          <Input v-model="listForm.name" placeholder="List name" />
          <!-- Platform is locked once a list is created — matches the
               original, which never lets you change platform on an existing
               App List (its appIds are platform-scoped). -->
          <Input v-model="listForm.platform" type="select" :options="platformOptions" :disabled="editingListId !== '__new__'" />
          <div class="max-h-32 overflow-y-auto space-y-1 border border-white/60 rounded-lg p-2 bg-white dark:bg-gray-800">
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
  </div>
</template>
