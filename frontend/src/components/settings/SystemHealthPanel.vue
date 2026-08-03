<script setup lang="ts">
// System Health tab — port of SystemHealthSettings.jsx (main.py:17618-17727
// backs the data). Card list (status icon, label, "Every X · last run Y ago
// · N error(s) in a row" subtext, conditional red last-error detail line,
// status pill) plus a header summary line ("N job(s) overdue · checked Xs
// ago") and Refresh button — was a plain <table> before this pass (gap-
// closure, post-Phase-11), the original has no table view for this at all.
import { Alert, Button, Spinner, StatusPill } from "@applivery/bluesky-vue";
import { onMounted } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useSystemHealthStore, type SystemHealthJobStatus } from "../../stores/systemHealth";

const DANGER = "#EF4444";

const store = useSystemHealthStore();

// Every component in this codebase defines its own local timeAgo — no
// shared util exists (AppliveryEventsPanel.vue, PoliciesTable.vue, etc.).
function timeAgo(isoString: string | null): string {
  if (!isoString) return "never";
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function friendlyInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

// Port of `statusMeta` (SystemHealthSettings.jsx) — check order matters:
// overdue beats a stale "ok" reading, error beats "no data yet".
function statusMeta(job: SystemHealthJobStatus): { label: string; color: "green" | "yellow" | "red" | "gray"; icon: keyof typeof ICONS } {
  if (job.overdue) return { label: "Overdue", color: "red", icon: "DangerTriangle" };
  if (job.lastStatus === "error") return { label: "Errored last tick", color: "yellow", icon: "CloseCircle" };
  if (job.lastStatus === "ok") return { label: "Healthy", color: "green", icon: "CheckCircle" };
  return { label: "No data yet", color: "gray", icon: "ClockCircle" };
}

const overdueCount = () => store.jobs.filter((j) => j.overdue).length;

onMounted(async () => {
  await store.fetchHealth();
});
</script>

<template>
  <div class="space-y-4">
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 max-w-2xl">
      Every background job in this app (Compliance evaluation, ticketing sync, installed-apps refresher, workflow wait-resumer, Case SLA monitoring, scheduled reports, snapshots, audit log rotation, log export, script run reconciliation) records a heartbeat here at the end of every tick. This is global across workspaces — these jobs each iterate every workspace internally, so there's one health status per job, not one per workspace. "Overdue" means a job hasn't reported in well over its own expected interval, which is the signal an unhandled crash (as opposed to a caught, logged error) actually leaves behind.
    </p>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <div class="flex items-center justify-between">
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{ overdueCount() > 0 ? `${overdueCount()} job${overdueCount() === 1 ? "" : "s"} overdue` : "All jobs reporting on schedule" }}
        <template v-if="store.checkedAt"> · checked {{ timeAgo(store.checkedAt) }}</template>
      </span>
      <Button variant="ghost" size="sm" :disabled="store.isLoading" @click="store.fetchHealth()">
        <component :is="ICONS.Refresh" :size="12" weight="Linear" :class="store.isLoading ? 'animate-spin' : ''" /> Refresh
      </Button>
    </div>

    <div v-if="store.isLoading && store.jobs.length === 0" class="flex items-center justify-center py-8">
      <Spinner size="sm" />
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="job in store.jobs"
        :key="job.key"
        class="p-3 rounded-xl flex items-center justify-between gap-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      >
        <div class="min-w-0 flex items-center gap-2.5">
          <component :is="ICONS[statusMeta(job).icon]" :size="15" weight="Linear" class="shrink-0" :style="{ color: statusMeta(job).color === 'red' ? DANGER : undefined }" />
          <div class="min-w-0">
            <p class="text-sm font-semibold truncate text-gray-900 dark:text-white">{{ job.label }}</p>
            <p class="text-[11px] truncate text-gray-500 dark:text-gray-400">
              Every {{ friendlyInterval(job.intervalSeconds) }} · last run {{ timeAgo(job.lastRunAt) }}
              <template v-if="job.consecutiveErrors > 0"> · {{ job.consecutiveErrors }} error(s) in a row</template>
            </p>
            <p v-if="job.lastDetail && job.lastStatus === 'error'" class="text-[10px] mt-0.5 truncate" :style="{ color: DANGER }" :title="job.lastDetail">{{ job.lastDetail }}</p>
          </div>
        </div>
        <StatusPill :label="statusMeta(job).label" :color="statusMeta(job).color" class="shrink-0" />
      </div>
      <p v-if="!store.isLoading && store.jobs.length === 0" class="text-xs text-gray-400 py-2">No background jobs reporting yet.</p>
    </div>
  </div>
</template>
