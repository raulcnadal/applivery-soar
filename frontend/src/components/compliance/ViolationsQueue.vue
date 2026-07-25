<script setup lang="ts">
// Violations review queue — filter by status, single/bulk approve/dismiss,
// CSV export. Port of the original app's Compliance "Awaiting review" queue
// (migration-plan.md Phase 3 checkpoint).
import { Alert, Button, Checkbox, EmptyState, Input, StatusPill } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useComplianceStore } from "../../stores/compliance";

const store = useComplianceStore();

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "auto_fired", label: "Auto-fired" },
  { value: "autorun_blocked", label: "autoRun blocked" },
  { value: "autorun_capped", label: "autoRun capped" },
  { value: "no_workflow", label: "No workflow" },
  { value: "workflow_unavailable", label: "Workflow unavailable" },
  { value: "", label: "All statuses" },
];

const STATUS_COLOR: Record<string, "green" | "yellow" | "orange" | "red" | "gray"> = {
  pending: "yellow", approved: "green", dismissed: "gray", auto_fired: "green",
  autorun_blocked: "red", autorun_capped: "orange", no_workflow: "gray", workflow_unavailable: "red",
};

const selected = ref<Set<string>>(new Set());
const bulkRunning = ref(false);
const bulkMessage = ref<string | null>(null);
const rowAction = ref<string | null>(null);

const allSelected = computed(() => store.violations.length > 0 && store.violations.every((v) => selected.value.has(v.id)));

function toggleOne(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set();
  } else {
    selected.value = new Set(store.violations.map((v) => v.id));
  }
}

async function refresh() {
  await store.fetchViolations();
  selected.value = new Set();
}

watch(() => store.violationsStatusFilter, refresh);
onMounted(refresh);

async function approve(id: string) {
  rowAction.value = id;
  try {
    await store.approveViolation(id);
  } catch (err: any) {
    bulkMessage.value = err?.response?.data?.detail || "Approve failed.";
  } finally {
    rowAction.value = null;
  }
}

async function dismiss(id: string) {
  rowAction.value = id;
  try {
    await store.dismissViolation(id);
  } catch (err: any) {
    bulkMessage.value = err?.response?.data?.detail || "Dismiss failed.";
  } finally {
    rowAction.value = null;
  }
}

async function bulkApproveSelected() {
  bulkRunning.value = true;
  bulkMessage.value = null;
  try {
    const res = await store.bulkApprove(Array.from(selected.value));
    bulkMessage.value = `Approved ${res.approved.length}, failed ${res.failed.length}.`;
    selected.value = new Set();
  } finally {
    bulkRunning.value = false;
  }
}

async function bulkDismissSelected() {
  bulkRunning.value = true;
  bulkMessage.value = null;
  try {
    const res = await store.bulkDismiss(Array.from(selected.value));
    bulkMessage.value = `Dismissed ${res.dismissed.length}, failed ${res.failed.length}.`;
    selected.value = new Set();
  } finally {
    bulkRunning.value = false;
  }
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
      <Input v-model="store.violationsStatusFilter" type="select" :options="statusOptions" class="w-52" />
      <Button variant="secondary" :loading="store.isLoadingViolations" @click="refresh">Refresh</Button>
      <a :href="store.exportViolationsUrl()" target="_blank" rel="noopener">
        <Button variant="ghost">Export CSV</Button>
      </a>
      <span class="text-sm text-gray-400">{{ store.violationsTotal }} total</span>
    </div>

    <Alert v-if="store.violationsError" type="danger">{{ store.violationsError }}</Alert>
    <Alert v-if="bulkMessage" type="info">{{ bulkMessage }}</Alert>

    <div v-if="selected.size > 0" class="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
      <p class="text-sm text-brand-800">{{ selected.size }} selected</p>
      <Button size="sm" :loading="bulkRunning" @click="bulkApproveSelected">Approve selected</Button>
      <Button size="sm" variant="secondary" :loading="bulkRunning" @click="bulkDismissSelected">Dismiss selected</Button>
    </div>

    <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="w-10 px-4 py-3"><Checkbox :model-value="allSelected" @update:model-value="toggleAll" /></th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Device</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Policy</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Detected</th>
            <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in store.violations" :key="v.id" class="border-b border-gray-100 last:border-0">
            <td class="px-4 py-3"><Checkbox :model-value="selected.has(v.id)" @update:model-value="toggleOne(v.id)" /></td>
            <td class="px-4 py-3">
              <p class="font-medium text-gray-900">{{ v.deviceName || v.deviceId }}</p>
              <p class="text-xs text-gray-400">{{ v.platform }}</p>
            </td>
            <td class="px-4 py-3 text-gray-700">{{ v.policyName || v.policyId }}</td>
            <td class="px-4 py-3"><StatusPill :label="v.status" :color="STATUS_COLOR[v.status] ?? 'gray'" /></td>
            <td class="px-4 py-3 text-gray-500">{{ formatDate(v.detectedAt) }}</td>
            <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
              <Button v-if="v.status === 'pending'" size="sm" :loading="rowAction === v.id" @click="approve(v.id)">Approve</Button>
              <Button v-if="v.status === 'pending'" size="sm" variant="ghost" :loading="rowAction === v.id" @click="dismiss(v.id)">Dismiss</Button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!store.isLoadingViolations && store.violations.length === 0" title="No violations" description="Nothing matches this filter right now." />
    </div>
  </div>
</template>
