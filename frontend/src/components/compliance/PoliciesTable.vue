<script setup lang="ts">
// Compliance Policies grid — port of the policy cards in
// CompliancePoliciesView.jsx (lines ~458-540): icon badge, condition
// summary, linked workflow name, last-evaluated, live violator count, three
// toggle chips (Enabled/Disabled, Auto-run/Review first, Cases on/off/
// auto-resolve), an autoRun-tripped badge, and quick evaluate/edit/delete
// actions. Was a plain table before this pass — the original has no table
// view for policies at all.
import { EmptyState } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type CompliancePolicy } from "../../stores/compliance";
import { useWorkflowsStore } from "../../stores/workflows";

const SUCCESS = "#22C55E";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";
const PRIMARY_BLUE = "#0241E3";

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };
const DEPLOYMENT_MODEL_LABELS: Record<string, string> = {
  supervised: "Supervised", unsupervised: "Unsupervised",
  work_profile: "Work Profile", cope: "COPE", device_owner: "Device Owner",
};

const props = defineProps<{
  policies: CompliancePolicy[];
  isLoading?: boolean;
  // Segment-scoping context (CompliancePoliciesView.jsx:452-457) — lets the
  // empty state tell "no policies exist at all" apart from "none in this
  // Segment", same distinction the original makes.
  totalPoliciesCount?: number;
  segmentName?: string | null;
}>();

const emit = defineEmits<{
  edit: [policy: CompliancePolicy];
}>();

const store = useComplianceStore();
const workflowsStore = useWorkflowsStore();
const evaluatingPolicyId = ref<string | null>(null);

const workflowsById = computed(() => Object.fromEntries(workflowsStore.workflows.map((w) => [w.id, w])));

onMounted(async () => {
  if (workflowsStore.workflows.length === 0) await workflowsStore.fetchWorkflows();
  if (props.policies.length > 0) await store.refreshViolatorCounts(props.policies.map((p) => p.id));
});

function conditionSummary(p: CompliancePolicy): string {
  const n = p.conditions?.length || 0;
  if (n === 0) return "No conditions";
  const logic = p.conditionLogic === "all" ? "ALL" : "ANY";
  return `${n} condition${n === 1 ? "" : "s"} (match ${logic})`;
}

function timeAgo(isoString?: string | null): string | null {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

async function toggleField(p: CompliancePolicy, field: "enabled" | "autoRun" | "openCaseOnViolation") {
  await store.updatePolicy(p.id, { ...p, [field]: !p[field] });
}

async function evaluate(p: CompliancePolicy) {
  evaluatingPolicyId.value = p.id;
  try {
    await store.evaluateNow(p.id);
  } finally {
    evaluatingPolicyId.value = null;
  }
}

async function remove(p: CompliancePolicy) {
  if (!confirm(`Delete policy "${p.name}"? This cannot be undone.`)) return;
  await store.deletePolicy(p.id);
}
</script>

<template>
  <EmptyState
    v-if="!isLoading && policies.length === 0"
    :title="(totalPoliciesCount ?? 0) === 0 ? 'No Compliance Policies yet' : `No policies in ${segmentName || 'this segment'}`"
    :description="
      (totalPoliciesCount ?? 0) === 0
        ? 'Define what &quot;out of compliance&quot; means and link it to a workflow to run automatically.'
        : 'Switch to Global or another segment to see more, or create one scoped to this segment.'
    "
  />
  <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
    <div v-for="p in policies" :key="p.id" class="rounded-xl p-4 shadow-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <div class="flex items-start gap-2 mb-2">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${WARNING}12` }">
          <component :is="ICONS.ShieldWarning" :size="16" weight="Linear" :style="{ color: WARNING }" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold truncate text-gray-900 dark:text-white">{{ p.name }}</p>
          <p class="text-xs truncate text-gray-400">{{ conditionSummary(p) }}</p>
        </div>
        <span
          class="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
          :style="{ backgroundColor: p.targetPlatform ? `${PRIMARY_BLUE}12` : '#9CA3AF15', color: p.targetPlatform ? PRIMARY_BLUE : '#9CA3AF' }"
        >
          {{ p.targetPlatform ? PLATFORM_LABELS[p.targetPlatform] ?? p.targetPlatform : "Common" }}{{ p.targetDeploymentModel ? ` · ${DEPLOYMENT_MODEL_LABELS[p.targetDeploymentModel] ?? p.targetDeploymentModel}` : "" }}
        </span>
      </div>
      <p v-if="p.description" class="text-xs mb-2 line-clamp-2 text-gray-400">{{ p.description }}</p>
      <p class="text-xs mb-1 inline-flex items-center gap-1 text-gray-400">
        <component :is="ICONS.Structure" :size="11" weight="Linear" /> {{ workflowsById[p.workflowId ?? ""]?.name || "No workflow linked" }}
      </p>
      <p class="text-xs mb-1 inline-flex items-center gap-1 text-gray-400" :title="p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleString() : undefined">
        <component :is="ICONS.ClockCircle" :size="11" weight="Linear" /> {{ p.lastEvaluatedAt ? `Last evaluated ${timeAgo(p.lastEvaluatedAt)}` : "Never evaluated" }}
      </p>
      <p class="text-xs mb-3 inline-flex items-center gap-1" :style="{ color: (store.violatorCounts[p.id] ?? 0) > 0 ? DANGER : '#9CA3AF' }">
        <component :is="ICONS.Smartphone" :size="11" weight="Linear" />
        {{ store.violatorCounts[p.id] == null ? "Violator count unavailable" : `${store.violatorCounts[p.id]} device${store.violatorCounts[p.id] === 1 ? "" : "s"} currently violating` }}
      </p>

      <div class="flex items-center gap-1.5 mb-3 flex-wrap">
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
          :style="{ backgroundColor: p.enabled ? `${SUCCESS}15` : '#9CA3AF15', color: p.enabled ? SUCCESS : '#9CA3AF' }"
          @click="toggleField(p, 'enabled')"
        >
          <component :is="p.enabled ? ICONS.CheckCircle : ICONS.CloseCircle" :size="10" weight="Linear" /> {{ p.enabled ? "Enabled" : "Disabled" }}
        </button>
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
          :style="{ backgroundColor: p.autoRun ? `${DANGER}12` : '#9CA3AF15', color: p.autoRun ? DANGER : '#9CA3AF' }"
          @click="toggleField(p, 'autoRun')"
        >
          <component :is="ICONS.Refresh" :size="10" weight="Linear" /> {{ p.autoRun ? "Auto-run" : "Review first" }}
        </button>
        <span
          v-if="p.autoRun && p.autoRunTripped"
          :title="p.autoRunTrippedReason || 'autoRun tripped — edit and re-save this policy to re-arm it'"
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
          :style="{ backgroundColor: `${DANGER}15`, color: DANGER }"
        >
          <component :is="ICONS.CloseCircle" :size="10" weight="Linear" /> autoRun tripped
        </span>
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
          :style="{ backgroundColor: (p.openCaseOnViolation ?? true) ? `${PRIMARY_BLUE}12` : '#9CA3AF15', color: (p.openCaseOnViolation ?? true) ? PRIMARY_BLUE : '#9CA3AF' }"
          title="Whether violating this policy opens a Case — edit the policy to also control auto-resolve on recovery"
          @click="toggleField(p, 'openCaseOnViolation')"
        >
          <component :is="ICONS.Folder" :size="10" weight="Linear" /> {{ (p.openCaseOnViolation ?? true) ? (p.autoResolveCaseOnRecovery ? "Cases: auto-resolve" : "Cases: on") : "Cases: off" }}
        </button>
        <span
          v-if="p.alertOnViolation"
          :title="p.lastAlertError ? `Last alert attempt had a problem: ${p.lastAlertError}` : 'Sends a rolled-up webhook/email alert when this policy is violated'"
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase"
          :style="{ backgroundColor: p.lastAlertError ? `${WARNING}15` : `${PRIMARY_BLUE}12`, color: p.lastAlertError ? WARNING : PRIMARY_BLUE }"
        >
          <component :is="p.lastAlertError ? ICONS.DangerTriangle : ICONS.Bell" :size="10" weight="Linear" /> {{ p.lastAlertError ? "Alerts: error" : "Alerts: on" }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <button
          title="Evaluate just this policy now"
          class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40"
          :disabled="evaluatingPolicyId !== null"
          @click="evaluate(p)"
        >
          <component :is="ICONS.Refresh" :size="13" weight="Linear" :class="evaluatingPolicyId === p.id ? 'animate-spin' : ''" />
        </button>
        <button class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('edit', p)">
          <component :is="ICONS.Pen" :size="12" weight="Linear" /> Edit
        </button>
        <button class="p-1.5 rounded-lg" style="color: #ef4444" @click="remove(p)">
          <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
        </button>
      </div>
    </div>
  </div>
</template>
