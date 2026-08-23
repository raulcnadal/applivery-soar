<script setup lang="ts">
// Script & OMA-URI Library — restyled to match DeviceFleetTable.vue's list
// experience (Devices main view): a toolbar with a search box + type/
// platform filter pills (kept from before this pass), a sortable-column
// table on desktop, and a stacked card list on narrow screens (<768px, via
// useBreakpoint) — same split PoliciesTable.vue/WorkflowsTable.vue now use.
import { computed, ref } from "vue";
import { EmptyState } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useBreakpoint } from "../../composables/useBreakpoint";
import { useActionLibraryStore, type ActionLibraryEntry } from "../../stores/actionLibrary";

const PRIMARY_BLUE = "#0241E3";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const PLATFORM_LABELS: Record<string, string> = { windows: "Windows", macos: "macOS" };
const TYPE_LABELS: Record<string, string> = { script: "Script", oma_uri: "OMA-URI command" };

// Pulled out to plain consts — a real Vue interpolation whose *content* is a
// string literal containing "}}" (e.g. `{{ "{{ device.x }}" }}`) breaks the
// SFC compiler's tokenizer: it scans for the first "}}" to close the
// mustache, finds the one inside the string first, and the leftover text
// fails to parse as a valid expression. Referencing a plain identifier here
// keeps the mustache's own source free of literal braces.
const deviceTemplateExample = "{{ device.x }}";
const userTemplateExample = "{{ user.x }}";

const props = defineProps<{ entries: ActionLibraryEntry[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [ActionLibraryEntry]; new: []; fetchApplivery: []; importGitRepo: [] }>();

const store = useActionLibraryStore();
const { isMobile } = useBreakpoint();

const search = ref("");
const typeFilter = ref<"all" | "script" | "oma_uri">("all");
const platformFilter = ref<"all" | "windows" | "macos">("all");

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return props.entries.filter((e) => {
    if (typeFilter.value !== "all" && e.type !== typeFilter.value) return false;
    if (typeFilter.value === "script" && platformFilter.value !== "all" && e.platform !== platformFilter.value) return false;
    if (!term) return true;
    return (
      e.name.toLowerCase().includes(term) ||
      (e.description || "").toLowerCase().includes(term) ||
      (e.assetName || e.assetId || "").toLowerCase().includes(term) ||
      (e.path || "").toLowerCase().includes(term)
    );
  });
});

type SortKey = "name" | "type" | "platform";
const sortBy = ref<SortKey | null>(null);
const sortDir = ref<"asc" | "desc">("asc");

const sorted = computed(() => {
  if (!sortBy.value) return filtered.value;
  const key = sortBy.value;
  const dir = sortDir.value === "asc" ? 1 : -1;
  const copy = [...filtered.value];
  copy.sort((a, b) => {
    switch (key) {
      case "name":
        return dir * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      case "type":
        return dir * (TYPE_LABELS[a.type] || a.type).localeCompare(TYPE_LABELS[b.type] || b.type);
      case "platform":
        return dir * (PLATFORM_LABELS[a.platform] || a.platform).localeCompare(PLATFORM_LABELS[b.platform] || b.platform);
      default:
        return 0;
    }
  });
  return copy;
});

function toggleSort(key: SortKey) {
  if (sortBy.value !== key) {
    sortBy.value = key;
    sortDir.value = "asc";
  } else if (sortDir.value === "asc") {
    sortDir.value = "desc";
  } else {
    sortBy.value = null;
  }
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "platform", label: "Platform" },
];

async function remove(entry: ActionLibraryEntry) {
  if (!confirm(`Remove "${entry.name}" from the library? Workflow steps that reference it will start failing.`)) return;
  await store.deleteEntry(entry.id);
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 class="text-lg font-bold text-gray-900 dark:text-white">Script & OMA-URI Library</h2>
        <p class="text-sm mt-1 text-gray-400">Named references you can pick from a workflow's "Run script" and "Custom OMA-URI command" steps, instead of retyping an Asset ID or path/value every time.</p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('fetchApplivery')">
          <component :is="ICONS.CloudDownload" :size="13" weight="Linear" /> Fetch from Applivery
        </button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('importGitRepo')">
          <component :is="ICONS.LinkCircle" :size="13" weight="Linear" /> Import from Git repo
        </button>
      </div>
    </div>

    <EmptyState v-if="!isLoading && entries.length === 0" title="Nothing in the library yet" description="Add a script pointer or an OMA-URI command, or fetch existing scripts from Applivery." />
    <div v-else class="rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
      <!-- Toolbar -->
      <div class="p-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 border-b border-gray-200 dark:border-gray-700">
        <div class="relative flex-1 max-w-sm">
          <component :is="ICONS.Magnifer" :size="15" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
          <input
            v-model="search"
            type="text"
            placeholder="Search name, description, asset/path…"
            class="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
          />
        </div>
        <div class="flex gap-1 p-0.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          <button v-for="[k, label] in [['all', 'All'], ['script', 'Scripts'], ['oma_uri', 'OMA-URI']] as const" :key="k" class="px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors" :class="typeFilter === k ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'" @click="typeFilter = k">
            {{ label }}
          </button>
        </div>
        <div v-if="typeFilter === 'script'" class="flex gap-1 p-0.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          <button
            v-for="[k, label] in [['all', 'All platforms'], ['windows', 'Windows'], ['macos', 'macOS']] as const"
            :key="k"
            class="px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="platformFilter === k ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
            @click="platformFilter = k"
          >
            {{ label }}
          </button>
        </div>
        <span class="text-xs ml-auto shrink-0 text-gray-400">{{ filtered.length }} of {{ entries.length }}</span>
      </div>

      <EmptyState v-if="filtered.length === 0" title="Nothing matches this filter" description="Try a different search term or filter." />

      <!-- Mobile — stacked cards -->
      <div v-else-if="isMobile" class="divide-y divide-gray-100 dark:divide-gray-800">
        <div v-for="e in sorted" :key="e.id" class="flex items-center gap-2.5 p-4">
          <component :is="e.type === 'script' ? ICONS.CodeFile : ICONS.Command" :size="14" weight="Linear" class="shrink-0 text-gray-400" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-semibold truncate text-gray-900 dark:text-white">{{ e.name }}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">{{ TYPE_LABELS[e.type] }}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 bg-gray-100 dark:bg-gray-700 text-gray-400">{{ PLATFORM_LABELS[e.platform] || e.platform }}</span>
              <span v-if="e.type === 'script' && e.scope" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 capitalize" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }">{{ e.scope }}</span>
            </div>
            <p v-if="e.description" class="text-[10px] mt-0.5 truncate text-gray-400">{{ e.description }}</p>
            <p v-if="e.type === 'script'" class="text-[10px] mt-0.5 truncate font-mono text-gray-400">Asset: {{ e.assetName || e.assetId }}</p>
            <p v-else class="text-[10px] mt-0.5 truncate font-mono text-gray-400">{{ e.path }}</p>
          </div>
          <button title="Edit" class="p-1.5 rounded-lg shrink-0 text-gray-400" @click="emit('edit', e)">
            <component :is="ICONS.Pen2" :size="13" weight="Linear" />
          </button>
          <button title="Remove" class="p-1.5 rounded-lg shrink-0" :style="{ color: DANGER }" @click="remove(e)">
            <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
          </button>
        </div>
      </div>

      <!-- Desktop — sortable column table -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm text-left">
          <thead class="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th v-for="col in COLUMNS" :key="col.key" class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider">
                <button class="inline-flex items-center gap-1 uppercase tracking-wider" :style="{ color: sortBy === col.key ? PRIMARY_BLUE : '#9CA3AF' }" @click="toggleSort(col.key)">
                  {{ col.label }} <component :is="ICONS.SortVertical" :size="11" weight="Linear" />
                </button>
              </th>
              <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Asset / Path</th>
              <th class="px-3 py-2.5 w-20"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, idx) in sorted" :key="e.id" class="align-top" :class="idx > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''">
              <td class="px-3 py-3 max-w-[260px]">
                <div class="flex items-start gap-2">
                  <component :is="e.type === 'script' ? ICONS.CodeFile : ICONS.Command" :size="14" weight="Linear" class="shrink-0 mt-0.5 text-gray-400" />
                  <div class="min-w-0">
                    <p class="font-semibold truncate text-gray-900 dark:text-white">{{ e.name }}</p>
                    <p v-if="e.description" class="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{{ e.description }}</p>
                  </div>
                </div>
              </td>
              <td class="px-3 py-3">
                <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 whitespace-nowrap" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">{{ TYPE_LABELS[e.type] }}</span>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-1 flex-wrap">
                  <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 bg-gray-100 dark:bg-gray-700 text-gray-400 whitespace-nowrap">{{ PLATFORM_LABELS[e.platform] || e.platform }}</span>
                  <span v-if="e.type === 'script' && e.scope" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 capitalize whitespace-nowrap" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }">{{ e.scope }}</span>
                </div>
              </td>
              <td class="px-3 py-3">
                <p v-if="e.type === 'script'" class="text-[11px] truncate max-w-[220px] font-mono text-gray-400">{{ e.assetName || e.assetId }}</p>
                <p v-else class="text-[11px] truncate max-w-[220px] font-mono text-gray-400">{{ e.path }}</p>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-1 justify-end">
                  <button title="Edit" class="p-1.5 rounded-lg shrink-0 text-gray-400" @click="emit('edit', e)">
                    <component :is="ICONS.Pen2" :size="13" weight="Linear" />
                  </button>
                  <button title="Remove" class="p-1.5 rounded-lg shrink-0" :style="{ color: DANGER }" @click="remove(e)">
                    <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="p-3 border-t border-gray-200 dark:border-gray-700">
        <button class="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-400 hover:text-brand-600 hover:border-brand-500 transition-colors" @click="emit('new')">
          <component :is="ICONS.AddSquare" :size="13" weight="Linear" /> Add to library
        </button>
      </div>
    </div>

    <p class="inline-flex items-start gap-1.5 text-[10px] mt-4" :style="{ color: WARNING }">
      <component :is="ICONS.InfoCircle" :size="11" weight="Linear" class="shrink-0 mt-0.5" />
      Script execution here is a direct, per-device push using an undocumented (but confirmed working) Applivery mechanism. OMA-URI's Value field and script Arguments both support {{ deviceTemplateExample }}/{{ userTemplateExample }} templating, resolved before/at send time respectively.
    </p>
  </div>
</template>
