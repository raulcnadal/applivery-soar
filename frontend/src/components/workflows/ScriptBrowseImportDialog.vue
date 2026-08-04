<script setup lang="ts">
// "Fetch from Applivery" bulk-import browser — lists every script Asset
// already in Applivery so an admin can bring some into the local library
// without re-typing Asset ids. Port of main.py:8471-5023 (browse + import).
import { Alert, Button, Modal, Spinner } from "@applivery/bluesky-vue";
import { computed, ref, watch } from "vue";
import { useActionLibraryStore } from "../../stores/actionLibrary";
import { useScriptAssetsStore, type ScriptAssetSummary } from "../../stores/scriptAssets";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; imported: [] }>();

const scriptAssetsStore = useScriptAssetsStore();
const libraryStore = useActionLibraryStore();

const items = ref<ScriptAssetSummary[]>([]);
const selectedIds = ref<Set<string>>(new Set());
const isImporting = ref(false);
const resultMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
// Port of FetchFromApplieryModal's platform/text filter row
// (ScriptLibraryModals.jsx:200-217) — filters the already-loaded browse
// list client-side, same as the original.
const platformFilter = ref<"all" | "windows" | "macos">("all");
const textFilter = ref("");
const filteredItems = computed(() =>
  items.value.filter((it) => (platformFilter.value === "all" || it.platform === platformFilter.value) && (!textFilter.value.trim() || it.name.toLowerCase().includes(textFilter.value.trim().toLowerCase()))),
);

watch(() => props.open, async (open) => {
  if (!open) return;
  selectedIds.value = new Set();
  resultMessage.value = null;
  errorMessage.value = null;
  platformFilter.value = "all";
  textFilter.value = "";
  items.value = await scriptAssetsStore.browse("all");
  if (scriptAssetsStore.error) errorMessage.value = scriptAssetsStore.error;
});

function toggle(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
}

async function importSelected() {
  isImporting.value = true;
  errorMessage.value = null;
  try {
    const assets = filteredItems.value.filter((i) => selectedIds.value.has(i.id));
    const { imported, skippedCount } = await libraryStore.importEntries(assets);
    resultMessage.value = `Imported ${imported.length} script${imported.length === 1 ? "" : "s"}` + (skippedCount ? ` (${skippedCount} already present, skipped)` : "");
    selectedIds.value = new Set();
    items.value = await scriptAssetsStore.browse("all");
    emit("imported");
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.detail || "Import failed.";
  } finally {
    isImporting.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="Fetch scripts from Applivery" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="errorMessage" type="danger">{{ errorMessage }}</Alert>
      <Alert v-if="resultMessage" type="success">{{ resultMessage }}</Alert>

      <div v-if="!scriptAssetsStore.isBrowsing" class="flex gap-2">
        <input v-model="textFilter" placeholder="Filter by name…" class="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500" />
        <select v-model="platformFilter" class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500">
          <option value="all">All platforms</option>
          <option value="windows">Windows</option>
          <option value="macos">macOS</option>
        </select>
      </div>

      <div v-if="scriptAssetsStore.isBrowsing" class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-6 justify-center"><Spinner size="sm" /> Loading script Assets…</div>
      <div v-else class="max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
        <label v-for="a in filteredItems" :key="a.id" class="flex items-center gap-2 px-3 py-2 text-sm" :class="{ 'opacity-50': a.alreadyInLibrary }">
          <input type="checkbox" :disabled="a.alreadyInLibrary" :checked="selectedIds.has(a.id)" @change="toggle(a.id)" />
          <span class="flex-1">{{ a.name }} <span class="text-xs text-gray-400">({{ a.platform }})</span></span>
          <span v-if="a.alreadyInLibrary" class="text-xs text-gray-400">Already in library</span>
        </label>
        <p v-if="filteredItems.length === 0" class="px-3 py-4 text-xs text-gray-400">No script Assets found in Applivery.</p>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isImporting" :disabled="selectedIds.size === 0" @click="importSelected">Import {{ selectedIds.size }} selected</Button>
        <Button variant="ghost" @click="emit('close')">Close</Button>
      </div>
    </div>
  </Modal>
</template>
