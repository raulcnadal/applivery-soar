<script setup lang="ts">
// Workflow list — card grid (the original has no table view at all here,
// see WorkflowsView.jsx:180-243): icon badge, step count + MDM/Auto-run-
// approved inline badges, target platform badge, description, and a
// Run/Dry-run/Version-history/Edit/Delete action row.
import { computed, onMounted } from "vue";
import { EmptyState } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
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

defineProps<{ workflows: Workflow[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [Workflow]; dryRun: [Workflow]; run: [Workflow]; versions: [Workflow] }>();

const store = useWorkflowsStore();
const authStore = useAuthStore();
const canRunDestructive = computed(() => authStore.hasRiskyAction("canRunDestructiveWorkflow"));
const canDelete = computed(() => authStore.hasRiskyAction("canDeletePolicyOrWorkflow"));
const notRunTitle = "Your role isn't permitted to run workflows with a destructive MDM step.";
const notDeleteTitle = "Your role isn't permitted to delete Workflows.";

onMounted(async () => {
  if (store.mdmActions.length === 0) await store.fetchMdmActions();
});

const mdmActionsByKey = computed(() => Object.fromEntries(store.mdmActions.map((a) => [a.key, a])));
function hasDestructive(w: Workflow): boolean {
  return (w.steps ?? []).some((s) => s.type === "mdm_action" && mdmActionsByKey.value[s.config?.action]?.destructive);
}

async function remove(w: Workflow) {
  if (!confirm(`Delete workflow "${w.name}"? This cannot be undone.`)) return;
  await store.deleteWorkflow(w.id);
}
</script>

<template>
  <EmptyState
    v-if="!isLoading && workflows.length === 0"
    title="No workflows yet"
    description="Create a chain of actions you can run against one or many devices."
  />
  <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
    <div v-for="w in workflows" :key="w.id" class="rounded-xl p-4 shadow-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <div class="flex items-start gap-2 mb-2">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
          <component :is="ICONS.Structure" :size="16" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold truncate text-gray-900 dark:text-white">{{ w.name }}</p>
          <p class="text-xs truncate flex items-center gap-1 text-gray-400">
            {{ w.steps?.length || 0 }} step{{ w.steps?.length === 1 ? "" : "s" }}
            <span v-if="hasDestructive(w)" class="inline-flex items-center gap-0.5" :style="{ color: WARNING }" title="Includes MDM device actions">
              <component :is="ICONS.DangerTriangle" :size="10" weight="Linear" /> MDM
            </span>
            <span
              v-if="hasDestructive(w) && w.allowUnattendedDestructive"
              class="inline-flex items-center gap-0.5"
              :style="{ color: SUCCESS }"
              title="Marked by its author as approved to run unattended — each Policy/Rule that fires it still needs its own separate acknowledgment"
            >
              <component :is="ICONS.ShieldCheck" :size="10" weight="Linear" /> Auto-run approved
            </span>
          </p>
        </div>
      </div>
      <span
        v-if="w.targetPlatform"
        class="inline-flex items-center gap-1 mb-2 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase"
        :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
      >
        {{ PLATFORM_LABELS[w.targetPlatform] || w.targetPlatform }}
        <template v-if="w.targetDeploymentModel"> · {{ MODEL_LABELS[w.targetDeploymentModel] || w.targetDeploymentModel }}</template>
      </span>
      <p v-if="w.description" class="text-xs mb-3 line-clamp-2 text-gray-400">{{ w.description }}</p>

      <div class="flex items-center gap-2 mt-3">
        <button
          :disabled="hasDestructive(w) && !canRunDestructive"
          :title="hasDestructive(w) && !canRunDestructive ? notRunTitle : undefined"
          class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
          :style="{ backgroundColor: PRIMARY_BLUE }"
          @click="emit('run', w)"
        >
          <component :is="ICONS.Play" :size="12" weight="Linear" /> Run
        </button>
        <button title="Dry run — safe preview, nothing is executed" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400" @click="emit('dryRun', w)">
          <component :is="ICONS.TestTube" :size="13" weight="Linear" />
        </button>
        <button title="Version history" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400" @click="emit('versions', w)">
          <component :is="ICONS.History" :size="13" weight="Linear" />
        </button>
        <button class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400" @click="emit('edit', w)">
          <component :is="ICONS.Pen" :size="13" weight="Linear" />
        </button>
        <button
          :disabled="!canDelete"
          :title="!canDelete ? notDeleteTitle : undefined"
          class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          style="color: #ef4444"
          @click="remove(w)"
        >
          <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
        </button>
      </div>
    </div>
  </div>
</template>
