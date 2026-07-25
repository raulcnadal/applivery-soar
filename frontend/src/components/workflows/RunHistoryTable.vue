<script setup lang="ts">
// Run history — completed + still-running/waiting runs, most recent first
// (main.py's GET /api/workflows/runs). CSV export delegates straight to the
// backend's streamed endpoint.
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { onMounted } from "vue";
import { useWorkflowsStore } from "../../stores/workflows";

const store = useWorkflowsStore();

onMounted(async () => {
  await store.fetchRuns();
});

const STATUS_COLOR: Record<string, "green" | "yellow" | "red" | "gray"> = {
  completed: "green", running: "yellow", waiting: "yellow", failed: "red",
};
</script>

<template>
  <div class="space-y-3">
    <div class="flex justify-end">
      <a :href="store.exportRunsUrl()" target="_blank" rel="noopener" class="text-sm text-brand-600 hover:text-brand-700 hover:underline">Export CSV</a>
    </div>
    <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Workflow</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Started</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Finished</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Devices</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Target</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in store.runs" :key="r.id" class="border-b border-gray-100 last:border-0">
            <td class="px-4 py-3 font-medium text-gray-900">{{ r.workflowName }}</td>
            <td class="px-4 py-3 text-gray-500">{{ new Date(r.startedAt).toLocaleString() }}</td>
            <td class="px-4 py-3 text-gray-500">{{ r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "—" }}</td>
            <td class="px-4 py-3"><StatusPill :label="r.status" :color="STATUS_COLOR[r.status] ?? 'gray'" /></td>
            <td class="px-4 py-3 text-gray-600">{{ r.completed }} / {{ r.total }}</td>
            <td class="px-4 py-3 text-gray-500">{{ r.targetDescription || "—" }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!store.isLoadingRuns && store.runs.length === 0" title="No workflow runs yet" description="Run a workflow manually, or let a Compliance Policy auto-fire one." />
    </div>
    <div class="flex justify-center">
      <Button size="sm" variant="ghost" @click="store.fetchRuns()">Refresh</Button>
    </div>
  </div>
</template>
