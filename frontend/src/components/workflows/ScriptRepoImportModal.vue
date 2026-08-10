<script setup lang="ts">
// "Import from Git repo" — one modal combining connected-repo management
// (left column) with directory browse + multi-select import (right
// column). Port of ScriptRepoModal (ScriptLibraryModals.jsx:220-380),
// reached from the Script & OMA-URI Library tab — was split across a
// separate top-level "Script Repos" tab + 2 dialogs in the migrated app;
// the original never has a persistent repos tab, only this on-demand modal.
import { computed, reactive, ref, watch } from "vue";
import { Alert } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useScriptReposStore, type ScriptRepoBrowseItem } from "../../stores/scriptRepos";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";
const PLATFORM_LABELS: Record<string, string> = { windows: "Windows", macos: "macOS" };

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; imported: [] }>();

const store = useScriptReposStore();

const activeRepoId = ref<string | null>(null);
const currentPath = ref("");
const items = ref<ScriptRepoBrowseItem[] | null>(null);
const error = ref<string | null>(null);
const selected = ref<Set<string>>(new Set());
const isImporting = ref(false);
const importResult = ref<{ imported: unknown[]; failed: Array<{ name?: string; error: string }> } | null>(null);

const showAddForm = ref(false);
const newRepo = reactive({ name: "", owner: "", repo: "", branch: "main", path: "" });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    activeRepoId.value = null;
    items.value = null;
    error.value = null;
    selected.value = new Set();
    importResult.value = null;
    showAddForm.value = false;
    void store.fetchRepos();
  },
);

async function browse(repoId: string, path?: string) {
  activeRepoId.value = repoId;
  items.value = null;
  error.value = null;
  selected.value = new Set();
  try {
    const res = await store.browse(repoId, path);
    items.value = res.items;
    currentPath.value = res.path;
  } catch (err: any) {
    items.value = [];
    error.value = err?.response?.data?.detail || "Could not browse this repo.";
  }
}

async function handleAddRepo() {
  if (!newRepo.name.trim() || !newRepo.owner.trim() || !newRepo.repo.trim()) return;
  const repo = await store.createRepo({ ...newRepo });
  showAddForm.value = false;
  Object.assign(newRepo, { name: "", owner: "", repo: "", branch: "main", path: "" });
  await store.fetchRepos();
  await browse((repo as any).id, (repo as any).path || "");
}

async function handleRemoveRepo(id: string) {
  if (!confirm("Disconnect this repo?")) return;
  await store.deleteRepo(id);
  if (activeRepoId.value === id) {
    activeRepoId.value = null;
    items.value = null;
  }
  await store.fetchRepos();
}

function quickAddApplivery() {
  Object.assign(newRepo, { name: "Applivery official scripts", owner: "applivery", repo: "applivery-mdm-scripts", branch: "main", path: "" });
  showAddForm.value = true;
}

function toggle(item: ScriptRepoBrowseItem) {
  const next = new Set(selected.value);
  if (next.has(item.path)) next.delete(item.path);
  else next.add(item.path);
  selected.value = next;
}

async function handleImport() {
  if (!activeRepoId.value) return;
  const files = (items.value ?? []).filter((i) => selected.value.has(i.path));
  if (!files.length) return;
  isImporting.value = true;
  error.value = null;
  try {
    importResult.value = await store.importFiles(activeRepoId.value, files);
    emit("imported");
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Import failed.";
  } finally {
    isImporting.value = false;
  }
}

const pathParts = computed(() => (currentPath.value ? currentPath.value.split("/").filter(Boolean) : []));
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-[280] flex items-center justify-center bg-black/45 p-4" @click.self="emit('close')">
    <div class="w-full rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg flex flex-col bg-white dark:bg-gray-800" style="max-width: 700px; max-height: 85vh">
      <div class="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
        <div class="min-w-0">
          <h3 class="text-sm font-semibold truncate text-gray-900 dark:text-white">Import scripts from a Git repo</h3>
          <p class="text-xs mt-0.5 text-gray-400">Browse a connected repo of script files and add selected ones to Applivery + the library.</p>
        </div>
        <button class="p-1 rounded-lg shrink-0 text-gray-400" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="16" weight="Linear" />
        </button>
      </div>

      <div class="overflow-y-auto p-4">
        <div v-if="importResult" class="space-y-2">
          <p class="inline-flex items-start gap-1.5 text-xs" :style="{ color: PRIMARY_BLUE }">
            <component :is="ICONS.CheckCircle" :size="13" weight="Linear" class="shrink-0 mt-0.5" />
            Imported {{ importResult.imported.length }} script{{ importResult.imported.length === 1 ? "" : "s" }}.
          </p>
          <div v-if="importResult.failed.length > 0" class="text-xs" :style="{ color: '#F59E0B' }">
            {{ importResult.failed.length }} failed:
            <ul class="mt-1 space-y-0.5">
              <li v-for="(f, i) in importResult.failed" :key="i" class="text-[10px]">"{{ f.name }}" — {{ f.error }}</li>
            </ul>
          </div>
          <div class="flex justify-end">
            <button class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" :style="{ backgroundColor: PRIMARY_BLUE }" @click="emit('close')">Done</button>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
          <div class="space-y-1.5">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Connected repos</p>
            <p v-if="store.repos.length === 0" class="text-[10px] text-gray-400">None yet.</p>
            <div v-for="r in store.repos" :key="r.id" class="flex items-center gap-1">
              <button
                class="flex-1 text-left px-2 py-1.5 rounded-lg text-[11px] truncate"
                :style="activeRepoId === r.id ? { backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE } : { color: 'var(--foreground)' }"
                @click="browse(r.id)"
              >
                {{ r.name }}
              </button>
              <button class="p-1 rounded shrink-0" :style="{ color: DANGER }" @click="handleRemoveRepo(r.id)">
                <component :is="ICONS.TrashBinMinimalistic" :size="11" weight="Linear" />
              </button>
            </div>
            <button class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] border border-dashed border-gray-200 dark:border-gray-700 text-gray-400" @click="quickAddApplivery">
              <component :is="ICONS.AddSquare" :size="11" weight="Linear" /> Applivery's repo
            </button>
            <button class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] border border-dashed border-gray-200 dark:border-gray-700 text-gray-400" @click="showAddForm = !showAddForm">
              <component :is="ICONS.LinkCircle" :size="11" weight="Linear" /> Custom repo…
            </button>
            <div v-if="showAddForm" class="space-y-1.5 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
              <input v-model="newRepo.name" placeholder="name" class="w-full px-2 py-1 rounded text-[10px] outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              <input v-model="newRepo.owner" placeholder="owner" class="w-full px-2 py-1 rounded text-[10px] outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              <input v-model="newRepo.repo" placeholder="repo" class="w-full px-2 py-1 rounded text-[10px] outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              <input v-model="newRepo.branch" placeholder="branch" class="w-full px-2 py-1 rounded text-[10px] outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              <input v-model="newRepo.path" placeholder="path (optional)" class="w-full px-2 py-1 rounded text-[10px] outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              <button class="w-full px-2 py-1 rounded text-[10px] font-semibold text-white" :style="{ backgroundColor: PRIMARY_BLUE }" @click="handleAddRepo">Connect</button>
            </div>
          </div>

          <div>
            <p v-if="!activeRepoId" class="text-xs text-gray-400">Select a repo to browse.</p>
            <div v-else class="space-y-2">
              <div class="flex items-center gap-1 text-[10px] flex-wrap text-gray-400">
                <button class="flex items-center gap-0.5 hover:underline" @click="browse(activeRepoId, '')">
                  <component :is="ICONS.Folder" :size="10" weight="Linear" /> root
                </button>
                <template v-for="(p, i) in pathParts" :key="i">
                  <span>/</span>
                  <button class="hover:underline" @click="browse(activeRepoId!, pathParts.slice(0, i + 1).join('/'))">{{ p }}</button>
                </template>
              </div>

              <Alert v-if="error" type="danger">{{ error }}</Alert>

              <p v-if="items === null" class="text-xs text-gray-400">Loading…</p>
              <p v-else-if="items.length === 0" class="text-xs text-gray-400">Empty directory.</p>
              <div v-else class="rounded-lg border border-gray-200 dark:border-gray-700 max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                <div v-for="e in items" :key="e.path" class="flex items-center gap-2 px-2.5 py-1.5">
                  <button v-if="e.type === 'dir'" class="flex items-center gap-2 flex-1 text-left text-xs hover:underline text-gray-900 dark:text-white" @click="browse(activeRepoId!, e.path)">
                    <component :is="ICONS.Folder" :size="13" weight="Linear" class="text-gray-400" /> {{ e.name }}
                  </button>
                  <label v-else class="flex items-center gap-2 flex-1 text-xs cursor-pointer" :class="e.importable ? 'text-gray-900 dark:text-white' : 'text-gray-400'">
                    <input type="checkbox" :checked="selected.has(e.path)" :disabled="!e.importable" @change="toggle(e)" />
                    <component :is="ICONS.CodeFile" :size="13" weight="Linear" class="text-gray-400" />
                    <span class="truncate flex-1">{{ e.name }}</span>
                    <span v-if="e.inferredPlatform" class="text-[9px] px-1.5 py-0.5 rounded-full font-light border border-gray-200 dark:border-gray-700 text-gray-400">{{ PLATFORM_LABELS[e.inferredPlatform] || e.inferredPlatform }}</span>
                  </label>
                </div>
              </div>

              <div class="flex items-center justify-between pt-1">
                <span class="text-[10px] text-gray-400">{{ selected.size }} selected</span>
                <button
                  :disabled="isImporting || selected.size === 0"
                  class="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                  :style="{ backgroundColor: PRIMARY_BLUE }"
                  @click="handleImport"
                >
                  {{ isImporting ? "Importing…" : `Import ${selected.size || ""}` }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
