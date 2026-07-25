<script setup lang="ts">
// App Lists / App Catalog manager — the requiredAppList/disallowedAppList
// condition source. Search live catalogs (App Store/MS Store/winget/
// Homebrew/Android known-apps) to add an entry without knowing the bundle
// id/package name by heart, then group entries into named lists.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref } from "vue";
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

const listForm = reactive({ name: "", platform: "apple", appIds: [] as string[] });
const editingListId = ref<string | null>(null);
const listError = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([store.fetchAppCatalog(), store.fetchAppLists()]);
});

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
      <p class="text-sm font-semibold text-gray-900">App Catalog</p>
      <div class="flex items-center gap-2">
        <Input v-model="searchPlatform" type="select" :options="platformOptions" class="w-40" />
        <Input v-model="searchQuery" placeholder="Search apps…" class="flex-1" @keyup.enter="runSearch" />
        <Button :loading="isSearching" @click="runSearch">Search</Button>
      </div>
      <Alert v-if="searchError" type="danger">{{ searchError }}</Alert>
      <div v-if="searchResults.length" class="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
        <div v-for="r in searchResults" :key="r.identifier" class="flex items-center justify-between text-sm px-1 py-1">
          <span class="truncate">{{ r.name }} <span class="text-gray-400">({{ r.identifier }})</span></span>
          <Button size="sm" variant="ghost" @click="addToCatalog(r)">Add</Button>
        </div>
      </div>

      <div class="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
        <div v-for="entry in store.appCatalog" :key="entry.id" class="flex items-center justify-between px-3 py-2 text-sm">
          <div>
            <p class="text-gray-900">{{ entry.name || entry.identifier }}</p>
            <p class="text-xs text-gray-400">{{ entry.platform }} · {{ entry.identifier }}</p>
          </div>
          <Button size="sm" variant="ghost" @click="removeCatalogEntry(entry)">Remove</Button>
        </div>
        <p v-if="store.appCatalog.length === 0" class="text-xs text-gray-400 px-3 py-3">No catalog entries yet — search above to add one.</p>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-gray-900">App Lists</p>
        <Button size="sm" variant="secondary" @click="startNewList">New list</Button>
      </div>

      <div v-if="editingListId" class="border border-brand-200 bg-brand-50 rounded-xl p-3 space-y-2">
        <Alert v-if="listError" type="danger">{{ listError }}</Alert>
        <Input v-model="listForm.name" placeholder="List name" />
        <Input v-model="listForm.platform" type="select" :options="platformOptions" />
        <div class="max-h-32 overflow-y-auto space-y-1 border border-white/60 rounded-lg p-2 bg-white">
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

      <div class="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
        <div v-for="list in store.appLists" :key="list.id" class="flex items-center justify-between px-3 py-2 text-sm">
          <div>
            <p class="text-gray-900">{{ list.name }}</p>
            <p class="text-xs text-gray-400">{{ list.platform }} · {{ list.appIds.length }} app(s)</p>
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
