<script setup lang="ts">
// Case detail drawer — port of CaseDetailDrawer (CasesView.jsx:756-1063):
// status/severity/assignee editors, context, run-workflow (destructive-
// gated), external ticket chips + retry/sync, editable MITRE tags with a
// "tags drifted from source policy" banner, threat-intel IOC enrichment,
// notes, and a labeled timeline.
import { computed, onMounted, ref, watch } from "vue";
import { Alert, Drawer } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { tacticColorMap, techniqueByIdMap } from "../../lib/mitreCatalog";
import MitreTagPicker from "../shared/MitreTagPicker.vue";
import MitreTagPills from "../shared/MitreTagPills.vue";
import SlaBadge from "./SlaBadge.vue";
import { useAuthStore } from "../../stores/auth";
import { useCasesStore, type Case } from "../../stores/cases";
import { useComplianceStore } from "../../stores/compliance";
import { useWorkflowsStore } from "../../stores/workflows";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";
const MUTED = "#94A3B8";

const props = defineProps<{ open: boolean; caseId: string | null }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const store = useCasesStore();
const complianceStore = useComplianceStore();
const workflowsStore = useWorkflowsStore();
const authStore = useAuthStore();

const kase = ref<Case | null>(null);
const isLoading = ref(false);
const actionError = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const busy = ref<string | null>(null);

const noteText = ref("");
const enrichValue = ref("");
const enrichForceOffered = ref(false);
const runWorkflowId = ref("");
const assigneeDraft = ref("");
const isEditingTags = ref(false);

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: WARNING },
  investigating: { label: "Investigating", color: PRIMARY_BLUE },
  resolved: { label: "Resolved", color: SUCCESS },
  closed: { label: "Closed", color: MUTED },
  false_positive: { label: "False positive", color: MUTED },
};
const SEVERITY_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: MUTED },
  medium: { label: "Medium", color: WARNING },
  high: { label: "High", color: "#F97316" },
  critical: { label: "Critical", color: DANGER },
};
const SOURCE_META: Record<string, { label: string; icon: keyof typeof ICONS }> = {
  compliance_violation: { label: "Compliance", icon: "ShieldWarning" },
  workflow_trigger: { label: "Inbound trigger", icon: "PlugCircle" },
  manual: { label: "Manual", icon: "Pen" },
};
const VERDICT_META: Record<string, { label: string; color: string }> = {
  malicious: { label: "Malicious", color: DANGER },
  suspicious: { label: "Suspicious", color: WARNING },
  clean: { label: "Clean", color: SUCCESS },
  unknown: { label: "Unknown", color: MUTED },
  error: { label: "Lookup failed", color: MUTED },
};
const TIMELINE_LABEL: Record<string, string> = {
  created: "Created", status_changed: "Status changed", severity_changed: "Severity changed",
  note_added: "Note", violation_linked: "Violation linked", workflow_run_linked: "Workflow run",
  assigned: "Assignment", reopened: "Reopened", device_recovered: "Device recovered",
};

const canRunDestructive = computed(() => authStore.hasRiskyAction("canRunDestructiveWorkflow"));

const tacticColor = computed(() => tacticColorMap(complianceStore.mitreTactics));
const techniqueById = computed(() => techniqueByIdMap(complianceStore.mitreTechniques));

const sourcePolicy = computed(() => (kase.value?.policyId ? complianceStore.policies.find((p) => p.id === kase.value!.policyId) : null));
function tagsMatchPolicy(caseTags: string[] | undefined, policyTags: string[] | undefined): boolean {
  const a = new Set(caseTags ?? []);
  const b = new Set(policyTags ?? []);
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
const tagsDrifted = computed(() => !!sourcePolicy.value && !tagsMatchPolicy(kase.value?.mitreTechniques, sourcePolicy.value.mitreTechniques));

const selectedWorkflow = computed(() => workflowsStore.workflows.find((w) => w.id === runWorkflowId.value));
const selectedIsDestructive = computed(() => (selectedWorkflow.value?.steps ?? []).some((s) => s.type === "mdm_action"));
const runBlockedByPermission = computed(() => selectedIsDestructive.value && !canRunDestructive.value);
const runBlockedTitle = "Your role isn't permitted to run workflows with a destructive MDM step.";

const hasTicketRefs = computed(() => (kase.value?.externalRefs ?? []).some((r) => r.type === "jira" || r.type === "servicenow"));
const reversedThreatIntel = computed(() => [...(kase.value?.threatIntel ?? [])].reverse());
const reversedTimeline = computed(() => [...(kase.value?.timeline ?? [])].reverse());

async function load() {
  if (!props.caseId) return;
  isLoading.value = true;
  actionError.value = null;
  actionMessage.value = null;
  enrichForceOffered.value = false;
  try {
    kase.value = await store.fetchCase(props.caseId);
    assigneeDraft.value = kase.value.assignee ?? "";
    runWorkflowId.value = "";
  } finally {
    isLoading.value = false;
  }
}

watch(() => [props.open, props.caseId], ([open]) => {
  if (open) load();
});

onMounted(async () => {
  if (workflowsStore.workflows.length === 0) await workflowsStore.fetchWorkflows();
  if (store.assigneeSuggestions.length === 0) await store.fetchAssigneeSuggestions();
  if (complianceStore.mitreTechniques.length === 0) await complianceStore.fetchMitreTechniques();
  // Loaded so a case can flag when its inherited MITRE tags have drifted
  // from what the source policy is tagged with today (CasesView.jsx:174-189).
  if (complianceStore.policies.length === 0) await complianceStore.fetchPolicies();
});

async function patch(payload: Partial<Pick<Case, "status" | "severity" | "assignee" | "mitreTechniques">>) {
  if (!kase.value) return;
  try {
    kase.value = await store.updateCase(kase.value.id, payload);
    emit("changed");
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Update failed.";
  }
}

function commitAssignee() {
  if (!kase.value) return;
  const next = assigneeDraft.value.trim();
  if (next !== (kase.value.assignee ?? "")) patch({ assignee: next || null });
}

async function addNote() {
  if (!kase.value || !noteText.value.trim()) return;
  busy.value = "note";
  actionError.value = null;
  try {
    kase.value = await store.addNote(kase.value.id, noteText.value.trim());
    noteText.value = "";
    emit("changed");
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Failed to add note.";
  } finally {
    busy.value = null;
  }
}

async function enrich(forceRefresh = false) {
  if (!kase.value || !enrichValue.value.trim()) return;
  busy.value = "enrich";
  actionError.value = null;
  enrichForceOffered.value = false;
  try {
    kase.value = await store.enrichCase(kase.value.id, enrichValue.value.trim(), forceRefresh);
    enrichValue.value = "";
  } catch (err: any) {
    // Already-checked (409) offers a one-click "force re-check" rather than
    // just failing — the dedup guard is meant to save a wasted lookup, not
    // to block a deliberate re-check (CasesView.jsx:790-800).
    if (err?.response?.status === 409) {
      actionError.value = err?.response?.data?.detail || "Already checked recently.";
      enrichForceOffered.value = true;
    } else {
      actionError.value = err?.response?.data?.detail || "Enrichment failed.";
    }
  } finally {
    busy.value = null;
  }
}

async function runWorkflow() {
  if (!kase.value || !runWorkflowId.value || runBlockedByPermission.value) return;
  busy.value = "run";
  actionError.value = null;
  try {
    const res = await store.runWorkflowFromCase(kase.value.id, runWorkflowId.value);
    kase.value = res.case;
    actionMessage.value = "Workflow launched.";
    emit("changed");
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Failed to run workflow.";
  } finally {
    busy.value = null;
  }
}

async function retryIntegrations() {
  if (!kase.value) return;
  busy.value = "retry";
  actionError.value = null;
  try {
    kase.value = await store.retryIntegrations(kase.value.id);
    actionMessage.value = "Integrations re-dispatched.";
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Retry failed.";
  } finally {
    busy.value = null;
  }
}

async function syncTicket() {
  if (!kase.value) return;
  busy.value = "sync";
  actionError.value = null;
  try {
    const res = await store.syncTicketStatus(kase.value.id);
    kase.value = res.case;
    actionMessage.value = res.autoClosed ? "Ticket resolved externally — case auto-closed." : "Ticket status synced.";
    emit("changed");
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Sync failed.";
  } finally {
    busy.value = null;
  }
}

function syncTagsFromPolicy() {
  if (!sourcePolicy.value) return;
  patch({ mitreTechniques: sourcePolicy.value.mitreTechniques ?? [] });
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
</script>

<template>
  <Drawer :open="open" :title="kase?.title ?? 'Case'" width="max-w-[480px] w-full" @close="emit('close')">
    <div v-if="isLoading" class="text-sm text-gray-400">Loading…</div>
    <div v-else-if="kase" class="space-y-6">
      <div class="flex items-center justify-between gap-2 -mt-2">
        <p class="text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1 text-gray-400">
          <component :is="ICONS[(SOURCE_META[kase.source]?.icon ?? 'Folder') as keyof typeof ICONS]" :size="11" weight="Linear" /> {{ SOURCE_META[kase.source]?.label ?? kase.source }}
        </p>
        <SlaBadge :sla-status="kase.slaStatus" />
      </div>

      <Alert v-if="actionError" type="danger">
        {{ actionError }}
        <button v-if="enrichForceOffered" class="ml-1 font-semibold underline" @click="enrich(true)">Force re-check</button>
      </Alert>
      <Alert v-if="actionMessage" type="info">{{ actionMessage }}</Alert>

      <!-- Status / Severity -->
      <section class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[10px] font-semibold uppercase mb-1 text-gray-400">Status</label>
          <select
            :value="kase.status"
            class="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 bg-white focus:ring-2 focus:ring-brand-500"
            :style="{ color: (STATUS_META[kase.status] ?? { color: '#111827' }).color, fontWeight: 600 }"
            @change="patch({ status: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="(v, k) in STATUS_META" :key="k" :value="k">{{ v.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-[10px] font-semibold uppercase mb-1 text-gray-400">Severity</label>
          <select
            :value="kase.severity"
            class="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 bg-white focus:ring-2 focus:ring-brand-500"
            :style="{ color: (SEVERITY_META[kase.severity] ?? { color: '#111827' }).color, fontWeight: 600 }"
            @change="patch({ severity: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="(v, k) in SEVERITY_META" :key="k" :value="k">{{ v.label }}</option>
          </select>
        </div>
      </section>

      <!-- Assignee -->
      <section>
        <label class="block text-[10px] font-semibold uppercase mb-1 text-gray-400">Assignee</label>
        <div class="flex items-center gap-2">
          <input
            v-model="assigneeDraft"
            list="case-assignee-suggestions"
            placeholder="Unassigned"
            class="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 bg-white text-gray-900 focus:ring-2 focus:ring-brand-500"
            @blur="commitAssignee"
            @keyup.enter="commitAssignee"
          />
          <datalist id="case-assignee-suggestions">
            <option v-for="email in store.assigneeSuggestions" :key="email" :value="email" />
          </datalist>
          <button
            v-if="authStore.email && kase.assignee !== authStore.email"
            class="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold shrink-0 border border-gray-200 text-gray-700"
            @click="assigneeDraft = authStore.email!; patch({ assignee: authStore.email })"
          >
            Assign to me
          </button>
        </div>
      </section>

      <!-- Context -->
      <section class="space-y-1.5 text-xs text-gray-400">
        <p v-if="kase.deviceName"><span class="font-semibold text-gray-900">Device:</span> {{ kase.deviceName }}</p>
        <p v-if="kase.policyName" class="inline-flex items-center gap-1">
          <component :is="ICONS.ShieldWarning" :size="11" weight="Linear" /> <span class="font-semibold text-gray-900">Policy:</span> {{ kase.policyName }}
        </p>
        <p v-if="kase.violationIds?.length">{{ kase.violationIds.length }} linked violation{{ kase.violationIds.length === 1 ? "" : "s" }}</p>
        <p v-if="kase.workflowRunIds?.length" class="inline-flex items-center gap-1">
          <component :is="ICONS.TransferHorizontal" :size="11" weight="Linear" /> {{ kase.workflowRunIds.length }} workflow run{{ kase.workflowRunIds.length === 1 ? "" : "s" }} launched
        </p>
        <p>Opened {{ timeAgo(kase.createdAt) }}{{ kase.closedAt ? ` · Closed ${timeAgo(kase.closedAt)}` : "" }}</p>
      </section>

      <!-- Run a workflow — the original hides this whole block if there's
           no linked device, and RunWorkflowFromCase itself returns null if
           no workflows exist at all (CasesView.jsx:632-671); no "no linked
           device" placeholder message exists in the original, so we don't
           show one either. -->
      <section v-if="kase.deviceId && workflowsStore.workflows.length > 0">
        <p class="text-[10px] font-semibold uppercase mb-1 text-gray-400">Run a workflow against this device</p>
        <div class="flex items-center gap-2">
          <select v-model="runWorkflowId" class="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 bg-white text-gray-900 focus:ring-2 focus:ring-brand-500">
            <option value="">Select workflow…</option>
            <option v-for="w in workflowsStore.workflows" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
          <button
            :disabled="!runWorkflowId || busy === 'run' || runBlockedByPermission"
            :title="runBlockedByPermission ? runBlockedTitle : undefined"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 shrink-0"
            @click="runWorkflow"
          >
            {{ busy === "run" ? "Running…" : "Run" }}
          </button>
        </div>
      </section>

      <!-- External tickets -->
      <section class="flex flex-wrap items-center gap-2">
        <span v-for="(ref, i) in kase.externalRefs" :key="i" class="inline-flex items-center gap-1.5">
          <a :href="ref.url" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
            {{ ref.type === "jira" ? "Jira" : ref.type === "servicenow" ? "ServiceNow" : ref.type }} {{ ref.id }}
            <component :is="ICONS.ArrowRightUp" :size="11" weight="Linear" />
          </a>
          <span
            v-if="ref.remoteStatus"
            :title="ref.remoteStatusCheckedAt ? `Synced ${timeAgo(ref.remoteStatusCheckedAt)}` : undefined"
            class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            :style="{ backgroundColor: ref.remoteResolved ? `${SUCCESS}15` : '#9CA3AF15', color: ref.remoteResolved ? SUCCESS : '#9CA3AF' }"
          >
            {{ ref.remoteStatus }}
          </span>
        </span>
        <button :disabled="busy === 'retry'" title="Re-fire ticketing/chat dispatch for this case — useful after fixing a broken integration" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 disabled:opacity-50" @click="retryIntegrations">
          <component :is="ICONS.Refresh" :size="11" weight="Linear" :class="busy === 'retry' ? 'animate-spin' : ''" /> {{ busy === "retry" ? "Retrying…" : "Retry integrations" }}
        </button>
        <button v-if="hasTicketRefs" :disabled="busy === 'sync'" title="Pull the linked ticket's live status from Jira/ServiceNow" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 disabled:opacity-50" @click="syncTicket">
          <component :is="ICONS.Refresh" :size="11" weight="Linear" :class="busy === 'sync' ? 'animate-spin' : ''" /> {{ busy === "sync" ? "Syncing…" : "Sync ticket status" }}
        </button>
      </section>

      <!-- MITRE ATT&CK tags -->
      <section>
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1.5 text-gray-400">
            <component :is="ICONS.Tag" :size="12" weight="Linear" /> MITRE ATT&amp;CK
          </p>
          <button class="text-xs font-medium inline-flex items-center gap-1" :style="{ color: PRIMARY_BLUE }" @click="isEditingTags = !isEditingTags">
            <component :is="ICONS.Pen2" :size="11" weight="Linear" /> {{ isEditingTags ? "Done" : "Edit" }}
          </button>
        </div>
        <div v-if="tagsDrifted" class="flex items-center justify-between gap-2 mb-2 px-2.5 py-1.5 rounded-lg text-[11px]" :style="{ backgroundColor: `${WARNING}10`, border: `1px solid ${WARNING}30`, color: WARNING }">
          <span>Source policy "{{ sourcePolicy?.name }}"'s tags have changed since this case opened.</span>
          <button class="font-semibold shrink-0 underline" @click="syncTagsFromPolicy">Sync from policy</button>
        </div>
        <MitreTagPicker
          v-if="isEditingTags"
          :techniques="complianceStore.mitreTechniques"
          :tactics="complianceStore.mitreTactics"
          :tactic-color="tacticColor"
          :selected="kase.mitreTechniques ?? []"
          :catalog-meta="complianceStore.mitreCatalogMeta"
          :can-refresh-catalog="true"
          @change="(ids) => patch({ mitreTechniques: ids })"
          @refresh="complianceStore.refreshMitreCatalogNow()"
        />
        <MitreTagPills v-else-if="kase.mitreTechniques?.length" :ids="kase.mitreTechniques" :technique-by-id="techniqueById" :tactic-color="tacticColor" size="md" />
        <p v-else class="text-xs text-gray-400">No techniques tagged.</p>
      </section>

      <!-- Threat intel -->
      <section>
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.TestTube" :size="12" weight="Linear" /> Threat Intel
        </p>
        <div class="flex items-center gap-2 mb-2">
          <input
            v-model="enrichValue"
            placeholder="IP, domain, URL, file hash, or email…"
            class="flex-1 px-3 py-2 rounded-lg text-xs outline-none border border-gray-200 bg-white text-gray-900 focus:ring-2 focus:ring-brand-500"
            @keyup.enter="enrich(false)"
          />
          <button :disabled="busy === 'enrich' || !enrichValue.trim()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 shrink-0" @click="enrich(false)">
            <component :is="ICONS.Magnifer" :size="12" weight="Linear" /> {{ busy === "enrich" ? "Checking…" : "Enrich" }}
          </button>
        </div>
        <div class="space-y-1.5">
          <div v-for="r in reversedThreatIntel" :key="r.id" class="px-3 py-2 rounded-lg text-xs border border-gray-200 bg-gray-50">
            <div class="flex items-center justify-between gap-2 mb-0.5">
              <span class="font-mono truncate text-gray-900">{{ r.ioc }}</span>
              <div class="flex items-center gap-1 shrink-0">
                <span v-if="r.cached" :title="`Cached result from ${r.checkedAt ? timeAgo(r.checkedAt) : 'earlier'} — not a fresh lookup`" class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">
                  Cached
                </span>
                <span
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                  :style="{ backgroundColor: `${(VERDICT_META[r.verdict] ?? { color: MUTED }).color}15`, color: (VERDICT_META[r.verdict] ?? { color: MUTED, label: r.verdict }).color }"
                >
                  {{ (VERDICT_META[r.verdict] ?? { label: r.verdict }).label }}
                </span>
              </div>
            </div>
            <p class="text-gray-400">
              {{ r.provider ? `${r.provider} · ` : "" }}{{ r.detail }}
              <template v-if="r.link">
                · <a :href="r.link" target="_blank" rel="noreferrer" :style="{ color: PRIMARY_BLUE }">View</a>
              </template>
              <template v-if="r.checkedAt"> · {{ timeAgo(r.checkedAt) }}</template>
            </p>
          </div>
          <p v-if="!kase.threatIntel || kase.threatIntel.length === 0" class="text-xs text-gray-400">No lookups yet.</p>
        </div>
      </section>

      <!-- Notes -->
      <section>
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.ChatRound" :size="12" weight="Linear" /> Notes ({{ kase.notes?.length || 0 }})
        </p>
        <div class="space-y-2 mb-3">
          <div v-for="n in kase.notes" :key="n.id" class="px-3 py-2 rounded-lg text-xs border border-gray-200 bg-gray-50">
            <p class="text-gray-900">{{ n.text }}</p>
            <p class="mt-1 text-gray-400">{{ n.authorEmail }} · {{ timeAgo(n.createdAt) }}</p>
          </div>
        </div>
        <div class="flex items-start gap-2">
          <textarea
            v-model="noteText"
            placeholder="Add a note…"
            rows="2"
            class="flex-1 px-3 py-2 rounded-lg text-xs outline-none border border-gray-200 bg-white text-gray-900 resize-none focus:ring-2 focus:ring-brand-500"
          />
          <button :disabled="busy === 'note' || !noteText.trim()" class="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 shrink-0" @click="addNote">Add</button>
        </div>
      </section>

      <!-- Timeline -->
      <section>
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.ClockCircle" :size="12" weight="Linear" /> Timeline
        </p>
        <div class="space-y-3">
          <div v-for="t in reversedTimeline" :key="t.id" class="flex gap-2.5 text-xs">
            <div class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" :style="{ backgroundColor: PRIMARY_BLUE }" />
            <div class="min-w-0">
              <p class="text-gray-900">{{ t.message }}</p>
              <p class="text-gray-400">{{ TIMELINE_LABEL[t.type] ?? t.type }} · {{ t.actor }} · {{ timeAgo(t.at) }}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Drawer>
</template>
