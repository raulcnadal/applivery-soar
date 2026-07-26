<script setup lang="ts">
// Audit Logs top-level view. Port of main.py:2530-2591 (list/actors/export).
import { Alert, Button, EmptyState, Input, PageHeader, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, reactive, watch } from "vue";
import { useAuditLogsStore, type AuditLogFilters } from "../stores/auditLogs";

const store = useAuditLogsStore();

const CATEGORIES = ["policy", "workflow", "violation", "case", "settings", "webhook", "system"];
const SEVERITIES = ["info", "warning", "critical"];
const SEVERITY_COLOR: Record<string, "green" | "yellow" | "red" | "gray"> = { info: "gray", warning: "yellow", critical: "red" };

const filters = reactive<AuditLogFilters>({ q: "", category: "", severity: "", actor: "", date_from: "", date_to: "" });

function activeFilters(): AuditLogFilters {
  const out: AuditLogFilters = {};
  if (filters.q) out.q = filters.q;
  if (filters.category) out.category = filters.category;
  if (filters.severity) out.severity = filters.severity;
  if (filters.actor) out.actor = filters.actor;
  if (filters.date_from) out.date_from = filters.date_from;
  if (filters.date_to) out.date_to = filters.date_to;
  return out;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(filters, () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => store.fetchLogs(activeFilters()), 300);
});

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString();
}

onMounted(async () => {
  await Promise.all([store.fetchLogs(), store.fetchActors()]);
});
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Audit Logs" :description="`${store.total} event${store.total === 1 ? '' : 's'} — retained ${store.retentionDays === 0 ? 'forever' : store.retentionDays + ' days'}`">
      <template #action>
        <Button variant="ghost" @click="store.exportCsv(activeFilters())">Export CSV</Button>
      </template>
    </PageHeader>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <div class="flex flex-wrap gap-3 items-end">
      <div class="w-64">
        <Input v-model="filters.q" placeholder="Search message, actor, target…" label="Search" />
      </div>
      <div>
        <label class="block text-xs font-medium mb-1.5 text-gray-500">Category</label>
        <select v-model="filters.category" class="rounded-lg px-3 py-2 text-sm border border-gray-200">
          <option value="">All</option>
          <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium mb-1.5 text-gray-500">Severity</label>
        <select v-model="filters.severity" class="rounded-lg px-3 py-2 text-sm border border-gray-200">
          <option value="">All</option>
          <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium mb-1.5 text-gray-500">Actor</label>
        <select v-model="filters.actor" class="rounded-lg px-3 py-2 text-sm border border-gray-200">
          <option value="">All</option>
          <option v-for="a in store.actors" :key="a" :value="a">{{ a }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium mb-1.5 text-gray-500">From</label>
        <input v-model="filters.date_from" type="date" class="rounded-lg px-3 py-2 text-sm border border-gray-200" />
      </div>
      <div>
        <label class="block text-xs font-medium mb-1.5 text-gray-500">To</label>
        <input v-model="filters.date_to" type="date" class="rounded-lg px-3 py-2 text-sm border border-gray-200" />
      </div>
    </div>

    <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Time</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Severity</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Category</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Action</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Actor</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Target</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Message</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in store.items" :key="e.id" class="border-b border-gray-100 last:border-0 align-top">
            <td class="px-4 py-3 text-gray-500 whitespace-nowrap">{{ formatTs(e.timestamp) }}</td>
            <td class="px-4 py-3"><StatusPill :label="e.severity" :color="SEVERITY_COLOR[e.severity] ?? 'gray'" /></td>
            <td class="px-4 py-3 text-gray-700">{{ e.category }}</td>
            <td class="px-4 py-3 text-gray-700 font-mono text-xs">{{ e.action }}</td>
            <td class="px-4 py-3 text-gray-700">{{ e.actor }}</td>
            <td class="px-4 py-3 text-gray-500">{{ e.targetName || e.targetId || "—" }}</td>
            <td class="px-4 py-3 text-gray-700 max-w-md">{{ e.message }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!store.isLoading && store.items.length === 0" title="No audit events match" description="Try widening your filters or date range." />
    </div>

    <div class="flex items-center justify-between text-sm text-gray-500">
      <span>{{ store.offset + 1 }}–{{ Math.min(store.offset + store.PAGE_SIZE, store.total) }} of {{ store.total }}</span>
      <div class="flex gap-2">
        <Button variant="ghost" size="sm" :disabled="store.offset === 0" @click="store.prevPage(activeFilters())">Previous</Button>
        <Button variant="ghost" size="sm" :disabled="store.offset + store.PAGE_SIZE >= store.total" @click="store.nextPage(activeFilters())">Next</Button>
      </div>
    </div>
  </div>
</template>
