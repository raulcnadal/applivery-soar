<script setup lang="ts">
// Case detail — status/severity/assignee editing, SLA badges, notes,
// timeline, threat intel enrichment, ticket refs, run-workflow. Port of
// GET/PUT /api/cases/{id} and its action endpoints (main.py:12006-12358).
import { Alert, Button, Drawer, Input, StatusPill } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useCasesStore, type Case } from "../../stores/cases";
import { useWorkflowsStore } from "../../stores/workflows";

const props = defineProps<{ open: boolean; caseId: string | null }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const store = useCasesStore();
const workflowsStore = useWorkflowsStore();

const kase = ref<Case | null>(null);
const isLoading = ref(false);
const actionError = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const busy = ref<string | null>(null);

const noteText = ref("");
const enrichValue = ref("");
const runWorkflowId = ref("");

const VERDICT_COLOR: Record<string, "green" | "yellow" | "orange" | "red" | "gray"> = { clean: "green", suspicious: "orange", malicious: "red", unknown: "gray", error: "gray" };

async function load() {
  if (!props.caseId) return;
  isLoading.value = true;
  actionError.value = null;
  actionMessage.value = null;
  try {
    kase.value = await store.fetchCase(props.caseId);
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
});

async function patch(payload: Partial<Pick<Case, "title" | "status" | "severity" | "assignee">>) {
  if (!kase.value) return;
  try {
    kase.value = await store.updateCase(kase.value.id, payload);
    emit("changed");
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Update failed.";
  }
}

async function addNote() {
  if (!kase.value || !noteText.value.trim()) return;
  busy.value = "note";
  actionError.value = null;
  try {
    kase.value = await store.addNote(kase.value.id, noteText.value.trim());
    noteText.value = "";
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Failed to add note.";
  } finally {
    busy.value = null;
  }
}

async function enrich() {
  if (!kase.value || !enrichValue.value.trim()) return;
  busy.value = "enrich";
  actionError.value = null;
  try {
    kase.value = await store.enrichCase(kase.value.id, enrichValue.value.trim());
    enrichValue.value = "";
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Enrichment failed.";
  } finally {
    busy.value = null;
  }
}

async function runWorkflow() {
  if (!kase.value || !runWorkflowId.value) return;
  busy.value = "run";
  actionError.value = null;
  try {
    const res = await store.runWorkflowFromCase(kase.value.id, runWorkflowId.value);
    kase.value = res.case;
    actionMessage.value = "Workflow launched.";
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
  } catch (err: any) {
    actionError.value = err?.response?.data?.detail || "Sync failed.";
  } finally {
    busy.value = null;
  }
}

const hasTicketRefs = computed(() => (kase.value?.externalRefs ?? []).some((r) => r.type === "jira" || r.type === "servicenow"));

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
</script>

<template>
  <Drawer :open="open" :title="kase?.title ?? 'Case'" width="w-[720px]" @close="emit('close')">
    <div v-if="isLoading" class="text-sm text-gray-400">Loading…</div>
    <div v-else-if="kase" class="space-y-6">
      <Alert v-if="actionError" type="danger">{{ actionError }}</Alert>
      <Alert v-if="actionMessage" type="info">{{ actionMessage }}</Alert>

      <section class="grid grid-cols-2 gap-3">
        <Input
          :model-value="kase.status"
          type="select"
          :options="['open', 'investigating', 'resolved', 'closed', 'false_positive'].map((s) => ({ value: s, label: s }))"
          label="Status"
          @update:model-value="patch({ status: $event as string })"
        />
        <Input
          :model-value="kase.severity"
          type="select"
          :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))"
          label="Severity"
          @update:model-value="patch({ severity: $event as string })"
        />
        <Input
          :model-value="kase.assignee ?? ''"
          type="select"
          :options="[{ value: '', label: 'Unassigned' }, ...store.assigneeSuggestions.map((a) => ({ value: a, label: a }))]"
          label="Assignee"
          @update:model-value="patch({ assignee: ($event as string) || null })"
        />
        <div class="space-y-1">
          <p class="text-xs font-medium text-gray-500">SLA</p>
          <div class="flex gap-2">
            <StatusPill v-if="kase.slaStatus?.ackBreached" label="Ack overdue" color="red" />
            <StatusPill v-if="kase.slaStatus?.resolveBreached" label="Resolve overdue" color="red" />
            <span v-if="!kase.slaStatus?.ackBreached && !kase.slaStatus?.resolveBreached" class="text-xs text-gray-400 pt-1">On track</span>
          </div>
        </div>
      </section>

      <section class="text-sm text-gray-600 grid grid-cols-2 gap-2">
        <p><span class="text-gray-400">Source:</span> {{ kase.source }}</p>
        <p><span class="text-gray-400">Device:</span> {{ kase.deviceName || "—" }}</p>
        <p><span class="text-gray-400">Policy:</span> {{ kase.policyName || "—" }}</p>
        <p><span class="text-gray-400">Opened:</span> {{ formatDate(kase.createdAt) }}</p>
      </section>

      <section v-if="kase.mitreTechniques.length" class="flex flex-wrap gap-1">
        <StatusPill v-for="t in kase.mitreTechniques" :key="t" :label="t" color="gray" />
      </section>

      <section class="space-y-2 border-t border-gray-100 pt-4">
        <p class="text-sm font-semibold text-gray-900">Run a workflow against the linked device</p>
        <div v-if="kase.deviceId" class="flex items-center gap-2">
          <Input
            :model-value="runWorkflowId"
            type="select"
            :options="workflowsStore.workflows.map((w) => ({ value: w.id, label: w.name }))"
            class="flex-1"
            @update:model-value="runWorkflowId = $event as string"
          />
          <Button size="sm" :loading="busy === 'run'" :disabled="!runWorkflowId" @click="runWorkflow">Run</Button>
        </div>
        <p v-else class="text-xs text-gray-400">This case has no linked device.</p>
        <div class="flex gap-2">
          <Button size="sm" variant="ghost" :loading="busy === 'retry'" @click="retryIntegrations">Retry integrations</Button>
          <Button v-if="hasTicketRefs" size="sm" variant="ghost" :loading="busy === 'sync'" @click="syncTicket">Sync ticket status</Button>
        </div>
      </section>

      <section v-if="kase.externalRefs.length" class="space-y-1 border-t border-gray-100 pt-4">
        <p class="text-sm font-semibold text-gray-900">Linked tickets</p>
        <a v-for="ref in kase.externalRefs" :key="ref.type + ref.id" :href="ref.url" target="_blank" rel="noopener" class="block text-sm text-brand-700 hover:underline">
          {{ ref.type }} {{ ref.id }} <span v-if="ref.remoteStatus" class="text-xs text-gray-400">— {{ ref.remoteStatus }}</span>
        </a>
      </section>

      <section class="space-y-2 border-t border-gray-100 pt-4">
        <p class="text-sm font-semibold text-gray-900">Threat intel</p>
        <div class="flex items-center gap-2">
          <Input v-model="enrichValue" placeholder="IP, domain, URL, hash, or email" class="flex-1" @keyup.enter="enrich" />
          <Button size="sm" :loading="busy === 'enrich'" :disabled="!enrichValue.trim()" @click="enrich">Check</Button>
        </div>
        <div v-if="kase.threatIntel.length" class="space-y-1">
          <div v-for="r in kase.threatIntel" :key="r.id" class="text-sm border border-gray-100 rounded-lg p-2">
            <div class="flex items-center justify-between">
              <span class="font-medium">{{ r.ioc }}</span>
              <StatusPill :label="r.verdict" :color="VERDICT_COLOR[r.verdict] ?? 'gray'" />
            </div>
            <p class="text-xs text-gray-500">{{ r.provider || "—" }}: {{ r.detail }}</p>
          </div>
        </div>
      </section>

      <section class="space-y-2 border-t border-gray-100 pt-4">
        <p class="text-sm font-semibold text-gray-900">Notes</p>
        <div class="flex items-center gap-2">
          <Input v-model="noteText" placeholder="Add a note…" class="flex-1" @keyup.enter="addNote" />
          <Button size="sm" :loading="busy === 'note'" :disabled="!noteText.trim()" @click="addNote">Add</Button>
        </div>
        <div v-for="n in kase.notes" :key="n.id" class="text-sm bg-gray-50 rounded-lg p-2">
          <p>{{ n.text }}</p>
          <p class="text-xs text-gray-400">{{ n.authorEmail }} · {{ formatDate(n.createdAt) }}</p>
        </div>
      </section>

      <section class="space-y-1 border-t border-gray-100 pt-4 pb-4">
        <p class="text-sm font-semibold text-gray-900">Timeline</p>
        <div v-for="t in [...kase.timeline].reverse()" :key="t.id" class="text-sm">
          <p class="text-gray-700">{{ t.message }}</p>
          <p class="text-xs text-gray-400">{{ t.actor }} · {{ formatDate(t.at) }}</p>
        </div>
      </section>
    </div>
  </Drawer>
</template>
