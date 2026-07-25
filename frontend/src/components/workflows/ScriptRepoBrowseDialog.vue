<script setup lang="ts">
// Browse one directory of a connected repo (GitHub Contents API) and import
// selected files as new Applivery script Assets + library entries. Port of
// main.py:8766-8872.
import { Alert, Button, Spinner, Modal } from "@applivery/bluesky-vue";
import { ref, watch } from "vue";
import { useScriptReposStore, type ScriptRepo, type ScriptRepoBrowseItem } from "../../stores/scriptRepos";

const props = defineProps<{ open: boolean; repo: ScriptRepo | null }>();
const emit = defineEmits<{ close: []; imported: [] }>();

const store = useScriptReposStore();
const currentPath = ref("");
const items = ref<ScriptRepoBrowseItem[]>([]);
const selected = ref<Set<string>>(new Set());
const isLoading = ref(false);
const isImporting = ref(false);
const errorMessage = ref<string | null>(null);
const resultMessage = ref<string | null>(null);

async function load(path?: string) {
  if (!props.repo) return;
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const res = await store.browse(props.repo.id, path);
    currentPath.value = res.path;
    items.value = res.items;
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.detail || "Failed to browse repo.";
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.open, (open) => {
  if (!open) return;
  selected.value = new Set();
  resultMessage.value = null;
  void load(props.repo?.path || "");
});

function enterDir(item: ScriptRepoBrowseItem) {
  void load(item.path);
}

function up() {
  const parts = currentPath.value.split("/").filter(Boolean);
  parts.pop();
  void load(parts.join("/"));
}

function toggle(item: ScriptRepoBrowseItem) {
  if (selected.value.has(item.path)) selected.value.delete(item.path);
  else selected.value.add(item.path);
}

async function importSelected() {
  if (!props.repo) return;
  isImporting.value = true;
  errorMessage.value = null;
  try {
    const files = items.value.filter((i) => selected.value.has(i.path));
    const { imported, failed } = await store.importFiles(props.repo.id, files);
    resultMessage.value = `Imported ${imported.length} file${imported.length === 1 ? "" : "s"}` + (failed.length ? `; ${failed.length} failed (${failed.map((f) => f.error).join("; ")})` : "");
    selected.value = new Set();
    emit("imported");
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.detail || "Import failed.";
  } finally {
    isImporting.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="repo ? `Browse ${repo.owner}/${repo.repo}` : 'Browse repo'" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="errorMessage" type="danger">{{ errorMessage }}</Alert>
      <Alert v-if="resultMessage" type="success">{{ resultMessage }}</Alert>

      <div class="flex items-center gap-2 text-xs text-gray-500">
        <Button size="sm" variant="ghost" :disabled="!currentPath" @click="up">↑ Up</Button>
        <span>/{{ currentPath }}</span>
      </div>

      <div v-if="isLoading" class="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center"><Spinner size="sm" /> Loading…</div>
      <div v-else class="max-h-96 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        <div v-for="item in items" :key="item.path" class="flex items-center gap-2 px-3 py-2 text-sm">
          <input v-if="item.type === 'file'" type="checkbox" :disabled="!item.importable" :checked="selected.has(item.path)" @change="toggle(item)" />
          <button
            v-if="item.type === 'dir'"
            type="button"
            class="flex-1 text-left font-medium text-gray-700 hover:text-brand-600"
            @click="enterDir(item)"
          >📁 {{ item.name }}</button>
          <span v-else class="flex-1">{{ item.name }} <span v-if="item.inferredPlatform" class="text-xs text-gray-400">({{ item.inferredPlatform }})</span></span>
          <span v-if="item.type === 'file' && !item.importable" class="text-xs text-gray-400">Not a recognized script</span>
        </div>
        <p v-if="items.length === 0" class="px-3 py-4 text-xs text-gray-400">Empty directory.</p>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isImporting" :disabled="selected.size === 0" @click="importSelected">Import {{ selected.size }} selected</Button>
        <Button variant="ghost" @click="emit('close')">Close</Button>
      </div>
    </div>
  </Modal>
</template>
