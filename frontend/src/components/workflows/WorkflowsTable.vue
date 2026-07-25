<script setup lang="ts">
// Workflows list — edit, dry-run preview, run now, version history, delete.
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { useWorkflowsStore, type Workflow } from "../../stores/workflows";

defineProps<{
  workflows: Workflow[];
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  edit: [workflow: Workflow];
  dryRun: [workflow: Workflow];
  run: [workflow: Workflow];
  versions: [workflow: Workflow];
}>();

const store = useWorkflowsStore();

async function remove(workflow: Workflow) {
  if (!confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) return;
  await store.deleteWorkflow(workflow.id);
}
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Workflow</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Target</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Steps</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Recovery</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Updated</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="w in workflows" :key="w.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3">
            <p class="font-medium text-gray-900">{{ w.name }}</p>
            <p v-if="w.description" class="text-xs text-gray-400">{{ w.description }}</p>
          </td>
          <td class="px-4 py-3 text-gray-600">
            {{ w.targetPlatform || "Any platform" }}
            <span v-if="w.targetDeploymentModel" class="text-gray-400"> / {{ w.targetDeploymentModel }}</span>
          </td>
          <td class="px-4 py-3 text-gray-600">{{ w.steps.length }}</td>
          <td class="px-4 py-3">
            <StatusPill :label="w.recovery?.enabled ? 'On' : 'Off'" :color="w.recovery?.enabled ? 'green' : 'gray'" />
          </td>
          <td class="px-4 py-3 text-gray-500">{{ new Date(w.updatedAt).toLocaleString() }}</td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="ghost" @click="emit('dryRun', w)">Dry run</Button>
            <Button size="sm" variant="secondary" @click="emit('run', w)">Run</Button>
            <Button size="sm" variant="ghost" @click="emit('versions', w)">Versions</Button>
            <Button size="sm" variant="secondary" @click="emit('edit', w)">Edit</Button>
            <Button size="sm" variant="ghost" @click="remove(w)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && workflows.length === 0" title="No workflows yet" description="Build one to automate MDM actions, notifications, and policy quarantine/restore across your fleet." />
  </div>
</template>
