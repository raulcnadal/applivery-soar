<script setup lang="ts">
// System Health tab. Port of main.py:17618-17727.
import { Alert, Button, StatusPill } from "@applivery/bluesky-vue";
import { onMounted } from "vue";
import { useSystemHealthStore } from "../../stores/systemHealth";

const store = useSystemHealthStore();

function statusFor(job: { lastStatus: string | null; overdue: boolean }): { label: string; color: "green" | "yellow" | "red" | "gray" } {
  if (!job.lastStatus) return { label: "Never run", color: "gray" };
  if (job.overdue) return { label: "Overdue", color: "red" };
  if (job.lastStatus === "error") return { label: "Error", color: "yellow" };
  return { label: "Healthy", color: "green" };
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

onMounted(async () => {
  await store.fetchHealth();
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 max-w-2xl">
        Every background job's last heartbeat — a job is flagged Overdue once it's gone 3x its own interval (minimum 5 minutes) without reporting in, even if it never logged an error.
      </p>
      <Button variant="ghost" size="sm" @click="store.fetchHealth()">Refresh</Button>
    </div>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <div class="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Job</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Interval</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Last run</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Consecutive errors</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in store.jobs" :key="job.key" class="border-b border-gray-100 dark:border-gray-800 last:border-0">
            <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ job.label }}</td>
            <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ formatInterval(job.intervalSeconds) }}</td>
            <td class="px-4 py-3"><StatusPill :label="statusFor(job).label" :color="statusFor(job).color" /></td>
            <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "—" }}</td>
            <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ job.consecutiveErrors }}</td>
            <td class="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-sm truncate" :title="job.lastDetail ?? ''">{{ job.lastDetail || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
