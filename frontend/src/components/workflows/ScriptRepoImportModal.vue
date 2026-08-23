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

const VENDOR_OPTIONS: Array<{ value: "github" | "gitlab" | "custom"; label: string }> = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "custom", label: "Custom / self-hosted (GitHub-compatible API)" },
];

const showAddForm = ref(false);
const newRepo = reactive({ name: "", vendor: "github" as "github" | "gitlab" | "custom", url: "", owner: "", repo: "", branch: "main", path: "", baseUrl: "", token: "" });

function resetNewRepo() {
  Object.assign(newRepo, { name: "", vendor: "github", url: "", owner: "", repo: "", branch: "main", path: "", baseUrl: "", token: "" });
}

// Best-effort client-side parse of a pasted repo URL into owner/repo (and,
// for a non-default host, an API base URL) — lets a user paste
// "https://github.com/owner/repo" or "https://gitlab.mycompany.com/group/
// project" instead of having to split it into fields by hand. Always
// editable afterward; this is a convenience prefill, not a hard requirement.
function parseRepoUrl(rawUrl: string, vendor: "github" | "gitlab" | "custom"): { owner: string; repo: string; baseUrl: string } | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const repo = parts[parts.length - 1];
  const owner = parts.slice(0, -1).join("/");
  const isDefaultHost = (vendor === "github" && u.hostname === "github.com") || (vendor === "gitlab" && u.hostname === "gitlab.com");
  const baseUrl = isDefaultHost ? "" : vendor === "github" ? `${u.origin}/api/v3` : u.origin;
  return { owner, repo, baseUrl };
}

watch([() => newRepo.url, () => newRepo.vendor], () => {
  const parsed = parseRepoUrl(newRepo.url, newRepo.vendor);
  if (!parsed) return;
  newRepo.owner = parsed.owner;
  newRepo.repo = parsed.repo;
  newRepo.baseUrl = parsed.baseUrl;
});

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
  const repo = await store.createRepo({
    name: newRepo.name,
    vendor: newRepo.vendor,
    owner: newRepo.owner,
    repo: newRepo.repo,
    branch: newRepo.branch,
    path: newRepo.path,
    baseUrl: newRepo.baseUrl || undefined,
    token: newRepo.token || undefined,
  });
  showAddForm.value = false;
  resetNewRepo();
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
  resetNewRepo();
  Object.assign(newRepo, { name: "Applivery official scripts", vendor: "github", owner: "applivery", repo: "applivery-mdm-scripts", branch: "main" });
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
    <div class="w-full rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg flex flex-col bg-white dark:bg-gray-800" style="max-width: 820px; max-height: 88vh">
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
                class="flex-1 min-w-0 text-left px-2 py-1.5 rounded-lg text-[11px]"
                :title="`${r.owner}/${r.repo}${r.hasToken ? ' (private token set)' : ''}`"
                :style="activeRepoId === r.id ? { backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE } : { color: 'var(--foreground)' }"
                @click="browse(r.id)"
              >
                <span class="truncate block">{{ r.name }}</span>
                <span class="flex items-center gap-1 text-[9px] font-medium uppercase text-gray-400">
                  {{ r.vendor || "github" }}
                  <component v-if="r.hasToken" :is="ICONS.Lock" :size="9" weight="Linear" title="Access token configured" />
                </span>
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

        <div v-if="showAddForm" class="mt-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-2">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Connect a repo</p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="text-[10px] text-gray-400">Vendor</label>
              <select v-model="newRepo.vendor" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                <option v-for="v in VENDOR_OPTIONS" :key="v.value" :value="v.value">{{ v.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-[10px] text-gray-400">Display name</label>
              <input v-model="newRepo.name" placeholder="e.g. Security scripts" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
          </div>

          <div>
            <label class="text-[10px] text-gray-400">Repository URL <span class="font-normal">(paste to auto-fill the fields below)</span></label>
            <input v-model="newRepo.url" placeholder="https://github.com/owner/repo" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="text-[10px] text-gray-400">Owner / namespace</label>
              <input v-model="newRepo.owner" placeholder="owner" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label class="text-[10px] text-gray-400">Repository</label>
              <input v-model="newRepo.repo" placeholder="repo" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="text-[10px] text-gray-400">Branch</label>
              <input v-model="newRepo.branch" placeholder="main" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label class="text-[10px] text-gray-400">Path (optional)</label>
              <input v-model="newRepo.path" placeholder="scripts/" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
          </div>

          <div v-if="newRepo.vendor !== 'github' || newRepo.baseUrl">
            <label class="text-[10px] text-gray-400">
              {{ newRepo.vendor === "gitlab" ? "Self-hosted instance URL (blank = gitlab.com)" : newRepo.vendor === "custom" ? "API base URL (required — e.g. a GitHub Enterprise or Gitea instance)" : "GitHub Enterprise API base URL (blank = public github.com)" }}
            </label>
            <input v-model="newRepo.baseUrl" placeholder="https://git.mycompany.com" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
          </div>

          <div>
            <label class="text-[10px] text-gray-400">Access token <span class="font-normal">(optional — only needed for a private repo)</span></label>
            <input v-model="newRepo.token" type="password" autocomplete="off" placeholder="Personal/project access token" class="w-full px-2 py-1.5 rounded text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button
              :disabled="!newRepo.name.trim() || !newRepo.owner.trim() || !newRepo.repo.trim()"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              :style="{ backgroundColor: PRIMARY_BLUE }"
              @click="handleAddRepo"
            >
              Connect
            </button>
            <button class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400" @click="showAddForm = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
