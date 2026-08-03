<script setup lang="ts">
// Script & OMA-URI Library — port of ActionLibraryView.jsx's list + toolbar
// (compact rows, type/platform filter chips, Fetch-from-Applivery/Import-
// from-Git-repo buttons). The original edits an entry inline in the list;
// this still opens ActionLibraryEntryDialog as a modal (a disclosed,
// timeboxed deviation — the form content itself matches) rather than the
// fully inline card-editing the original uses.
import { computed, ref } from "vue";
import { EmptyState } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
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

const typeFilter = ref<"all" | "script" | "oma_uri">("all");
const platformFilter = ref<"all" | "windows" | "macos">("all");

const filtered = computed(() =>
  props.entries.filter((e) => (typeFilter.value === "all" || e.type === typeFilter.value) && (typeFilter.value !== "script" || platformFilter.value === "all" || e.platform === platformFilter.value)),
);

async function remove(entry: ActionLibraryEntry) {
  if (!confirm(`Remove "${entry.name}" from the library? Workflow steps that reference it will start failing.`)) return;
  await store.deleteEntry(entry.id);
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 class="text-lg font-bold text-gray-900">Script & OMA-URI Library</h2>
        <p class="text-sm mt-1 text-gray-400">Named references you can pick from a workflow's "Run script" and "Custom OMA-URI command" steps, instead of retyping an Asset ID or path/value every time.</p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700" @click="emit('fetchApplivery')">
          <component :is="ICONS.CloudDownload" :size="13" weight="Linear" /> Fetch from Applivery
        </button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700" @click="emit('importGitRepo')">
          <component :is="ICONS.LinkCircle" :size="13" weight="Linear" /> Import from Git repo
        </button>
      </div>
    </div>

    <div class="flex items-center gap-2 mb-3 max-w-2xl flex-wrap">
      <div class="flex gap-1 p-0.5 rounded-lg bg-gray-50">
        <button v-for="[k, label] in [['all', 'All'], ['script', 'Scripts'], ['oma_uri', 'OMA-URI']] as const" :key="k" class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors" :class="typeFilter === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'" @click="typeFilter = k">
          {{ label }}
        </button>
      </div>
      <div v-if="typeFilter === 'script'" class="flex gap-1 p-0.5 rounded-lg bg-gray-50">
        <button
          v-for="[k, label] in [['all', 'All platforms'], ['windows', 'Windows'], ['macos', 'macOS']] as const"
          :key="k"
          class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
          :class="platformFilter === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'"
          @click="platformFilter = k"
        >
          {{ label }}
        </button>
      </div>
    </div>

    <div class="space-y-2.5 max-w-2xl">
      <EmptyState v-if="!isLoading && entries.length === 0" title="Nothing in the library yet" description="Add a script pointer or an OMA-URI command, or fetch existing scripts from Applivery." />
      <p v-else-if="filtered.length === 0" class="text-[11px] leading-relaxed text-gray-400">Nothing matches this filter.</p>
      <div v-for="e in filtered" :key="e.id" class="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-200 shadow-sm bg-white">
        <component :is="e.type === 'script' ? ICONS.CodeFile : ICONS.Command" :size="14" weight="Linear" class="shrink-0 text-gray-400" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold truncate text-gray-900">{{ e.name }}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">{{ TYPE_LABELS[e.type] }}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 bg-gray-100 text-gray-400">{{ PLATFORM_LABELS[e.platform] || e.platform }}</span>
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

      <button class="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-gray-200 text-xs font-medium text-gray-400 hover:text-brand-600 hover:border-brand-500 transition-colors" @click="emit('new')">
        <component :is="ICONS.AddSquare" :size="13" weight="Linear" /> Add to library
      </button>
    </div>

    <p class="inline-flex items-start gap-1.5 text-[10px] mt-4 max-w-2xl" :style="{ color: WARNING }">
      <component :is="ICONS.InfoCircle" :size="11" weight="Linear" class="shrink-0 mt-0.5" />
      Script execution here is a direct, per-device push using an undocumented (but confirmed working) Applivery mechanism. OMA-URI's Value field and script Arguments both support {{ deviceTemplateExample }}/{{ userTemplateExample }} templating, resolved before/at send time respectively.
    </p>
  </div>
</template>
