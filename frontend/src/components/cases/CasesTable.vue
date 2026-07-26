<script setup lang="ts">
// Cases list — filter by status, bulk assign/close, click a row to open the
// detail drawer. Port of the original app's Cases queue list.
import { Button, Checkbox, EmptyState, Input, StatusPill } from "@applivery/bluesky-vue";
import { computed, ref } from "vue";
import type { Case } from "../../stores/cases";

const props = defineProps<{ cases: Case[]; isLoading: boolean }>();
const emit = defineEmits<{ open: [Case]; bulkUpdate: [string[], { status?: string | null; assignee?: string | null }] }>();

const statusFilter = ref("");
const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "false_positive", label: "False positive" },
];

const SEVERITY_COLOR: Record<string, "green" | "yellow" | "orange" | "red"> = {
  low: "green", medium: "yellow", high: "orange", critical: "red",
};
const STATUS_COLOR: Record<string, "green" | "yellow" | "orange" | "red" | "gray"> = {
  open: "yellow", investigating: "orange", resolved: "green", closed: "gray", false_positive: "gray",
};

const filtered = computed(() => (statusFilter.value ? props.cases.filter((c) => c.status === statusFilter.value) : props.cases));

const selected = ref<Set<string>>(new Set());
const allSelected = computed(() => filtered.value.length > 0 && filtered.value.every((c) => selected.value.has(c.id)));

function toggleOne(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(filtered.value.map((c) => c.id));
}

function bulkClose() {
  emit("bulkUpdate", Array.from(selected.value), { status: "closed" });
  selected.value = new Set();
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <Input v-model="statusFilter" type="select" :options="statusOptions" class="w-52" />
      <span class="text-sm text-gray-400">{{ filtered.length }} case{{ filtered.length === 1 ? '' : 's' }}</span>
    </div>

    <div v-if="selected.size > 0" class="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
      <p class="text-sm text-brand-800">{{ selected.size }} selected</p>
      <Button size="sm" variant="secondary" @click="bulkClose">Close selected</Button>
    </div>

    <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="w-10 px-4 py-3"><Checkbox :model-value="allSelected" @update:model-value="toggleAll" /></th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Case</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Severity</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">SLA</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Assignee</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Opened</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.id" class="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer" @click="emit('open', c)">
            <td class="px-4 py-3" @click.stop><Checkbox :model-value="selected.has(c.id)" @update:model-value="toggleOne(c.id)" /></td>
            <td class="px-4 py-3">
              <p class="font-medium text-gray-900">{{ c.title }}</p>
              <p class="text-xs text-gray-400">{{ c.deviceName || c.source }}</p>
            </td>
            <td class="px-4 py-3"><StatusPill :label="c.severity" :color="SEVERITY_COLOR[c.severity] ?? 'gray'" /></td>
            <td class="px-4 py-3"><StatusPill :label="c.status" :color="STATUS_COLOR[c.status] ?? 'gray'" /></td>
            <td class="px-4 py-3">
              <StatusPill v-if="c.slaStatus?.ackBreached" label="Ack overdue" color="red" />
              <StatusPill v-else-if="c.slaStatus?.resolveBreached" label="Resolve overdue" color="red" />
              <span v-else class="text-xs text-gray-400">On track</span>
            </td>
            <td class="px-4 py-3 text-gray-700">{{ c.assignee || "—" }}</td>
            <td class="px-4 py-3 text-gray-500">{{ formatDate(c.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!isLoading && filtered.length === 0" title="No cases" description="Nothing matches this filter right now." />
    </div>
  </div>
</template>
