<script setup lang="ts">
// App Lists / App Catalog manager — the requiredAppList/disallowedAppList
// condition source. Search live catalogs (App Store/MS Store/winget/
// Homebrew/Android known-apps) to add an entry without knowing the bundle
// id/package name by heart, then group entries into named lists.
//
// Deliberately deferred vs. the original AppListsView.jsx (not built this
// pass — flagging rather than silently dropping):
//   - Quick-start presets (one-click common browser/collaboration app sets).
//   - The installed-app inventory sync panel (coverage %, self-reported
//     count, oldest sync age, "refresh now").
// Both are additive UI over data this store doesn't currently fetch: no
// inventory-coverage endpoint is wired up on the frontend side yet. What
// *is* included here: manual catalog entry (name + raw identifier) and a
// "used by N polic(ies)" indicator per list, computed from the already-
// loaded policies' requiredAppList/disallowedAppList conditions.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useComplianceStore, type AppCatalogEntry, type AppList } from "../../stores/compliance";

const store = useComplianceStore();

const platformOptions = [
  { value: "apple", label: "Apple (iOS/iPadOS)" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];

const searchPlatform = ref("apple");
const searchQuery = ref("");
const searchResults = ref<Array<{ identifier: string; name: string; iconUrl?: string }>>([]);
const isSearching = ref(false);
const searchError = ref<string | null>(null);

// Manual entry — for anything the live catalog search can't find (spec:
// "Manual entry — name + raw identifier for anything not found via
// search").
const manualName = ref("");
const manualIdentifier = ref("");

const listForm = reactive({ name: "", platform: "apple", appIds: [] as string[] });
const editingListId = ref<string | null>(null);
const listError = ref<string | null>(null);

// Which Compliance Policies reference each App List, via the
// requiredAppList/disallowedAppList condition types — spec: "Each list
// shows ... which Compliance Policies currently reference it."
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
  await Promise.all([store.fetchAppCatalog(), store.fetchAppLists()]);
});

async function addManualEntry() {
  if (!manualName.value.trim() || !manualIdentifier.value.trim()) return;
  await store.addAppCatalogEntry({ platform: searchPlatform.value, identifier: manualIdentifier.value.trim(), name: manualName.value.trim(), source: "manual" });
  manualName.value = "";
  manualIdentifier.value = "";
}

async function runSearch() {
  if (searchQuery.value.trim().length < 2) return;
  isSearching.value = true;
  searchError.value = null;
  try {
    searchResults.value = await store.searchApps(searchPlatform.value, searchQuery.value);
  } catch (err: any) {
    searchError.value = err?.response?.data?.detail || "Search failed.";
    searchResults.value = [];
  } finally {
    isSearching.value = false;
  }
}

async function addToCatalog(item: { identifier: string; name: string }) {
  await store.addAppCatalogEntry({ platform: searchPlatform.value, identifier: item.identifier, name: item.name, source: "search" });
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
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <section class="space-y-3">
      <p class="text-sm font-semibold text-gray-900 dark:text-white">App Catalog</p>
      <div class="flex items-center gap-2">
        <Input v-model="searchPlatform" type="select" :options="platformOptions" class="w-40" />
        <Input v-model="searchQuery" placeholder="Search apps…" class="flex-1" @keyup.enter="runSearch" />
        <Button :loading="isSearching" @click="runSearch">Search</Button>
      </div>
      <Alert v-if="searchError" type="danger">{{ searchError }}</Alert>
      <div v-if="searchResults.length" class="space-y-1 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
        <div v-for="r in searchResults" :key="r.identifier" class="flex items-center justify-between text-sm px-1 py-1">
          <span class="truncate">{{ r.name }} <span class="text-gray-400">({{ r.identifier }})</span></span>
          <Button size="sm" variant="ghost" @click="addToCatalog(r)">Add</Button>
        </div>
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
            <p class="text-xs text-gray-400">{{ entry.platform }} · {{ entry.identifier }}</p>
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
              {{ list.platform }} · {{ list.appIds.length }} app(s)
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
