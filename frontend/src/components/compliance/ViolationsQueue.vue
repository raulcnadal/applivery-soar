<script setup lang="ts">
// Violations / review queue — port of CompliancePoliciesView.jsx's inline
// "Awaiting review" + "Recent activity" sections (lines ~350-460). Lives
// directly on the Policies tab in the original, not a separate tab — see
// ComplianceView.vue. Awaiting review shows only pending violations with
// select-all + bulk Approve&run/Dismiss; Recent activity is everything else
// with its own status label set, an "Escalated" badge, and load-more
// pagination.
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useAuthStore } from "../../stores/auth";
import { useComplianceStore } from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const authStore = useAuthStore();
const store = useComplianceStore();
const canBulkTriage = computed(() => authStore.hasRiskyAction("canBulkTriage"));
const notPermittedTitle = "Your role isn't permitted to bulk-triage violations.";

const busyViolationId = ref<string | null>(null);
const selectedIds = ref<string[]>([]);
const isBulkBusy = ref(false);
const historyLimit = ref(15);

const pending = computed(() => store.violations.filter((v) => v.status === "pending"));
const history = computed(() => store.violations.filter((v) => v.status !== "pending"));

const STATUS_META: Record<string, { color: string; label: string }> = {
  auto_fired: { color: PRIMARY_BLUE, label: "Auto-fired" },
  approved: { color: "#22C55E", label: "Approved & ran" },
  dismissed: { color: "#9CA3AF", label: "Dismissed" },
  no_workflow: { color: WARNING, label: "No workflow linked" },
  autorun_blocked: { color: DANGER, label: "autoRun blocked" },
  autorun_capped: { color: WARNING, label: "autoRun capped — queued" },
  workflow_unavailable: { color: DANGER, label: "Workflow unavailable" },
};
function statusMeta(status: string) {
  return STATUS_META[status] ?? { color: "#9CA3AF", label: status };
}

function escalatedTitle(workflowName?: string | null): string {
  return `Escalated to "${workflowName}" based on device risk tier`;
}

async function refresh(limit?: number) {
  store.violationsLimit = limit ?? historyLimit.value + 15;
  store.violationsStatusFilter = "";
  await store.fetchViolations();
}

onMounted(() => refresh());

function toggleOne(id: string) {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) selectedIds.value.splice(idx, 1);
  else selectedIds.value.push(id);
}
function toggleSelectAllPending() {
  if (selectedIds.value.length === pending.value.length) selectedIds.value = [];
  else selectedIds.value = pending.value.map((v) => v.id);
}

async function approve(id: string) {
  busyViolationId.value = id;
  try {
    await store.approveViolation(id);
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Failed to approve.");
  } finally {
    busyViolationId.value = null;
  }
}
async function dismiss(id: string) {
  busyViolationId.value = id;
  try {
    await store.dismissViolation(id);
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Failed to dismiss.");
  } finally {
    busyViolationId.value = null;
  }
}

async function bulkApprove() {
  if (selectedIds.value.length === 0) return;
  if (!confirm(`Approve & run remediation for ${selectedIds.value.length} violation(s)?`)) return;
  isBulkBusy.value = true;
  try {
    const res = await store.bulkApprove(selectedIds.value);
    if (res.failed.length) alert(`${res.failed.length} could not be approved.`);
    selectedIds.value = [];
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Bulk approve failed.");
  } finally {
    isBulkBusy.value = false;
  }
}
async function bulkDismiss() {
  if (selectedIds.value.length === 0) return;
  if (!confirm(`Dismiss ${selectedIds.value.length} violation(s)?`)) return;
  isBulkBusy.value = true;
  try {
    await store.bulkDismiss(selectedIds.value);
    selectedIds.value = [];
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Bulk dismiss failed.");
  } finally {
    isBulkBusy.value = false;
  }
}

function loadMoreHistory() {
  historyLimit.value += 25;
  refresh(historyLimit.value);
}

function exportCsv() {
  window.open(store.exportViolationsUrl(), "_blank");
}
</script>

<template>
  <div>
    <!-- Awaiting review -->
    <div v-if="pending.length > 0" class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <component :is="ICONS.ClockCircle" :size="14" weight="Linear" :style="{ color: WARNING }" />
          <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Awaiting review ({{ pending.length }})</p>
        </div>
        <div v-if="selectedIds.length > 0" class="flex items-center gap-2">
          <span class="text-xs text-gray-400">{{ selectedIds.length }} selected</span>
          <button
            :disabled="isBulkBusy || !canBulkTriage"
            :title="!canBulkTriage ? notPermittedTitle : undefined"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 disabled:opacity-50"
            @click="bulkDismiss"
          >
            Dismiss selected
          </button>
          <button
            :disabled="isBulkBusy || !canBulkTriage"
            :title="!canBulkTriage ? notPermittedTitle : undefined"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
            :style="{ backgroundColor: PRIMARY_BLUE }"
            @click="bulkApprove"
          >
            Approve &amp; run selected
          </button>
        </div>
      </div>
      <div class="rounded-xl overflow-hidden border border-gray-200">
        <div class="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
          <input type="checkbox" :checked="selectedIds.length === pending.length" class="shrink-0" @change="toggleSelectAllPending" />
          <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Select all</span>
        </div>
        <div v-for="(v, i) in pending" :key="v.id" class="flex items-center gap-3 px-4 py-3 bg-white" :class="i > 0 ? 'border-t border-gray-200' : ''">
          <input type="checkbox" :checked="selectedIds.includes(v.id)" class="shrink-0" @change="toggleOne(v.id)" />
          <component :is="ICONS.ShieldWarning" :size="16" weight="Linear" class="shrink-0" :style="{ color: WARNING }" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate text-gray-900">{{ v.deviceName }} <span class="text-gray-400">violated</span> {{ v.policyName }}</p>
            <p class="text-xs truncate text-gray-400">
              Would run "{{ v.workflowName || "Unknown workflow" }}" — {{ v.matchedConditions?.length || 0 }} matched condition{{ (v.matchedConditions?.length || 0) === 1 ? "" : "s" }}
            </p>
          </div>
          <button :disabled="busyViolationId === v.id" class="px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 border border-gray-200 text-gray-700 disabled:opacity-50" @click="dismiss(v.id)">Dismiss</button>
          <button :disabled="busyViolationId === v.id" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white shrink-0 disabled:opacity-50" :style="{ backgroundColor: PRIMARY_BLUE }" @click="approve(v.id)">Approve &amp; run</button>
        </div>
      </div>
    </div>

    <!-- Recent activity -->
    <div v-if="history.length > 0">
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Recent activity {{ store.violationsTotal ? `(${history.length} of ${store.violationsTotal})` : "" }}</p>
        <button class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700" @click="exportCsv">
          <component :is="ICONS.Folder" :size="12" weight="Linear" /> Export CSV
        </button>
      </div>
      <div class="rounded-xl overflow-hidden border border-gray-200">
        <div v-for="(v, i) in history" :key="v.id" class="flex items-center gap-3 px-4 py-2.5 text-sm bg-white" :class="i > 0 ? 'border-t border-gray-200' : ''">
          <span class="truncate flex-1 text-gray-900">
            {{ v.deviceName }} — {{ v.policyName }}
            <span v-if="v.escalated" class="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" :style="{ backgroundColor: `${DANGER}15`, color: DANGER }" :title="escalatedTitle(v.workflowName)">
              Escalated
            </span>
          </span>
          <span class="text-xs shrink-0" :style="{ color: statusMeta(v.status).color }">{{ statusMeta(v.status).label }}</span>
        </div>
      </div>
      <button v-if="history.length < store.violationsTotal" class="mt-3 w-full py-2 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700" @click="loadMoreHistory">
        Load more ({{ store.violationsTotal - history.length }} remaining)
      </button>
    </div>
  </div>
</template>
