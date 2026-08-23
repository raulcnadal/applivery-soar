<script setup lang="ts">
// Workflows list — restyled to match DeviceFleetTable.vue's list experience
// (Devices main view): a toolbar with a search box, a sortable-column table
// on desktop, and a stacked card list on narrow screens (<768px, via
// useBreakpoint) — same split PoliciesTable.vue now uses for Compliance.
// Platform filtering stays a page-level control in WorkflowsView.vue (it
// also governs the tab's own layout reservation trick); this only adds
// free-text search + column sorting on top of whatever the page already
// scoped the list to.
import { computed, ref } from "vue";
import { EmptyState } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useBreakpoint } from "../../composables/useBreakpoint";
import { useAuthStore } from "../../stores/auth";
import { useWorkflowsStore, type Workflow } from "../../stores/workflows";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows", aosp: "AOSP" };
const MODEL_LABELS: Record<string, string> = {
  supervised: "Supervised", unsupervised: "Unsupervised",
  work_profile: "Work Profile", cope: "COPE", device_owner: "Device Owner",
};

const props = defineProps<{ workflows: Workflow[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [Workflow]; dryRun: [Workflow]; run: [Workflow]; versions: [Workflow] }>();

const store = useWorkflowsStore();
const authStore = useAuthStore();
const { isMobile } = useBreakpoint();
const canRunDestructive = computed(() => authStore.hasRiskyAction("canRunDestructiveWorkflow"));
const canDelete = computed(() => authStore.hasRiskyAction("canDeletePolicyOrWorkflow"));
const notRunTitle = "Your role isn't permitted to run workflows with a destructive MDM step.";
const notDeleteTitle = "Your role isn't permitted to delete Workflows.";

// Port of WorkflowsView.jsx:194 — the list card's own hasDestructive is a
// broader, UI-only check ("includes ANY mdm_action step at all") than the
// catalog-driven `_workflow_has_destructive_step` the backend actually
// enforces on POST /run (workflows.controller.ts:148, matched by
// PolicyBuilder's narrower isDestructiveWorkflow for the autoRun
// acknowledgment). The backend is still authoritative either way — this
// just needs to match the original's (more conservative) card display.
function hasDestructive(w: Workflow): boolean {
  return (w.steps ?? []).some((s) => s.type === "mdm_action");
}

function platformLabel(w: Workflow): string {
  return w.targetPlatform ? PLATFORM_LABELS[w.targetPlatform] || w.targetPlatform : "Common";
}

async function remove(w: Workflow) {
  if (!confirm(`Delete workflow "${w.name}"? This cannot be undone.`)) return;
  await store.deleteWorkflow(w.id);
}

// ── Toolbar: search ──
const search = ref("");
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return props.workflows;
  return props.workflows.filter((w) => w.name.toLowerCase().includes(term) || (w.description || "").toLowerCase().includes(term));
});

type SortKey = "name" | "platform" | "steps";
const sortBy = ref<SortKey | null>(null);
const sortDir = ref<"asc" | "desc">("asc");
const DEFAULT_SORT_DIR: Record<SortKey, "asc" | "desc"> = { name: "asc", platform: "asc", steps: "desc" };

const sorted = computed(() => {
  if (!sortBy.value) return filtered.value;
  const key = sortBy.value;
  const dir = sortDir.value === "asc" ? 1 : -1;
  const copy = [...filtered.value];
  copy.sort((a, b) => {
    switch (key) {
      case "name":
        return dir * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      case "platform":
        return dir * platformLabel(a).localeCompare(platformLabel(b));
      case "steps":
        return dir * ((a.steps?.length || 0) - (b.steps?.length || 0));
      default:
        return 0;
    }
  });
  return copy;
});

function toggleSort(key: SortKey) {
  if (sortBy.value !== key) {
    sortBy.value = key;
    sortDir.value = DEFAULT_SORT_DIR[key];
  } else if (sortDir.value === DEFAULT_SORT_DIR[key]) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortBy.value = null;
  }
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Workflow" },
  { key: "platform", label: "Platform" },
  { key: "steps", label: "Steps" },
];
</script>

<template>
  <EmptyState v-if="!isLoading && workflows.length === 0" title="No workflows yet" description="Create a chain of actions you can run against one or many devices." />
  <div v-else class="rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
    <!-- Toolbar -->
    <div class="p-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 border-b border-gray-200 dark:border-gray-700">
      <div class="relative flex-1 max-w-sm">
        <component :is="ICONS.Magnifer" :size="15" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Search workflows, description…"
          class="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
        />
      </div>
      <span class="text-xs ml-auto shrink-0 text-gray-400">{{ filtered.length }} of {{ workflows.length }}</span>
    </div>

    <EmptyState v-if="filtered.length === 0" title="No workflows match your search" description="Try a different search term." />

    <!-- Mobile — stacked cards -->
    <div v-else-if="isMobile" class="divide-y divide-gray-100 dark:divide-gray-800">
      <div v-for="w in sorted" :key="w.id" class="p-4">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
            <component :is="ICONS.Structure" :size="16" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2 flex-wrap">
              <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ w.name }}</p>
              <span v-if="w.targetPlatform" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
                {{ PLATFORM_LABELS[w.targetPlatform] || w.targetPlatform }}
                <template v-if="w.targetDeploymentModel"> · {{ MODEL_LABELS[w.targetDeploymentModel] || w.targetDeploymentModel }}</template>
              </span>
            </div>
            <p class="text-xs mt-0.5 flex items-center gap-1 text-gray-400">
              {{ w.steps?.length || 0 }} step{{ w.steps?.length === 1 ? "" : "s" }}
              <span v-if="hasDestructive(w)" class="inline-flex items-center gap-0.5" :style="{ color: WARNING }" title="Includes MDM device actions">
                <component :is="ICONS.DangerTriangle" :size="10" weight="Linear" /> MDM
              </span>
              <span v-if="hasDestructive(w) && w.allowUnattendedDestructive" class="inline-flex items-center gap-0.5" :style="{ color: SUCCESS }" title="Marked by its author as approved to run unattended">
                <component :is="ICONS.ShieldCheck" :size="10" weight="Linear" /> Auto-run approved
              </span>
            </p>
            <p v-if="w.description" class="text-xs mt-1 text-gray-400">{{ w.description }}</p>
            <div class="flex items-center gap-2 mt-3 flex-wrap">
              <button
                :disabled="hasDestructive(w) && !canRunDestructive"
                :title="hasDestructive(w) && !canRunDestructive ? notRunTitle : undefined"
                class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                :style="{ backgroundColor: PRIMARY_BLUE }"
                @click="emit('run', w)"
              >
                <component :is="ICONS.Play" :size="12" weight="Linear" /> Run
              </button>
              <button title="Dry run" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400" @click="emit('dryRun', w)">
                <component :is="ICONS.TestTube" :size="13" weight="Linear" />
              </button>
              <button title="Version history" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400" @click="emit('versions', w)">
                <component :is="ICONS.History" :size="13" weight="Linear" />
              </button>
              <button class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400" @click="emit('edit', w)">
                <component :is="ICONS.Pen" :size="13" weight="Linear" />
              </button>
              <button :disabled="!canDelete" :title="!canDelete ? notDeleteTitle : undefined" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed" style="color: #ef4444" @click="remove(w)">
                <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
              </button>
            </div>
          </div>
        </div>
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
            <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Flags</th>
            <th class="px-3 py-2.5 w-[232px]"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(w, idx) in sorted" :key="w.id" class="align-top" :class="idx > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''">
            <td class="px-3 py-3 max-w-[280px]">
              <div class="flex items-start gap-2.5">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
                  <component :is="ICONS.Structure" :size="14" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
                </div>
                <div class="min-w-0">
                  <p class="font-semibold truncate text-gray-900 dark:text-white">{{ w.name }}</p>
                  <p v-if="w.description" class="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{{ w.description }}</p>
                </div>
              </div>
            </td>
            <td class="px-3 py-3">
              <span v-if="w.targetPlatform" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase whitespace-nowrap" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
                {{ PLATFORM_LABELS[w.targetPlatform] || w.targetPlatform }}
                <template v-if="w.targetDeploymentModel"> · {{ MODEL_LABELS[w.targetDeploymentModel] || w.targetDeploymentModel }}</template>
              </span>
              <span v-else class="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style="background-color: #9ca3af15; color: #9ca3af">Common</span>
            </td>
            <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">{{ w.steps?.length || 0 }} step{{ w.steps?.length === 1 ? "" : "s" }}</td>
            <td class="px-3 py-3">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span v-if="hasDestructive(w)" class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }" title="Includes MDM device actions">
                  <component :is="ICONS.DangerTriangle" :size="10" weight="Linear" /> MDM
                </span>
                <span
                  v-if="hasDestructive(w) && w.allowUnattendedDestructive"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
                  :style="{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }"
                  title="Marked by its author as approved to run unattended — each Policy/Rule that fires it still needs its own separate acknowledgment"
                >
                  <component :is="ICONS.ShieldCheck" :size="10" weight="Linear" /> Auto-run approved
                </span>
              </div>
            </td>
            <td class="px-3 py-3 w-[232px]">
              <div class="flex items-center gap-1.5 justify-end flex-nowrap whitespace-nowrap">
                <button
                  :disabled="hasDestructive(w) && !canRunDestructive"
                  :title="hasDestructive(w) && !canRunDestructive ? notRunTitle : undefined"
                  class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  :style="{ backgroundColor: PRIMARY_BLUE }"
                  @click="emit('run', w)"
                >
                  <component :is="ICONS.Play" :size="12" weight="Linear" /> Run
                </button>
                <button title="Dry run — safe preview, nothing is executed" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 shrink-0" @click="emit('dryRun', w)">
                  <component :is="ICONS.TestTube" :size="13" weight="Linear" />
                </button>
                <button title="Version history" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 shrink-0" @click="emit('versions', w)">
                  <component :is="ICONS.History" :size="13" weight="Linear" />
                </button>
                <button class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 shrink-0" @click="emit('edit', w)">
                  <component :is="ICONS.Pen" :size="13" weight="Linear" />
                </button>
                <button
                  :disabled="!canDelete"
                  :title="!canDelete ? notDeleteTitle : undefined"
                  class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  style="color: #ef4444"
                  @click="remove(w)"
                >
                  <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
