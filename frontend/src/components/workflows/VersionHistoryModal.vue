<script setup lang="ts">
// Version history — every pre-edit/pre-restore snapshot, with a lightweight
// index-based "Show changes" diff and Restore. Port of WorkflowVersionsModal
// (WorkflowRunModals.jsx:544-665) — was a side Drawer, now a centered Modal
// matching the original's ModalShell (wide).
import { ref, watch } from "vue";
import { Button, EmptyState, Modal, Spinner } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useWorkflowsStore, type Workflow, type WorkflowVersion } from "../../stores/workflows";

const SUCCESS = "#22C55E";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const props = defineProps<{ open: boolean; workflow: Workflow | null }>();
const emit = defineEmits<{ close: []; restored: [] }>();

const store = useWorkflowsStore();
const versions = ref<WorkflowVersion[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
const restoringId = ref<string | null>(null);
const diffOpenId = ref<string | null>(null);

async function load() {
  if (!props.workflow) return;
  isLoading.value = true;
  error.value = null;
  try {
    versions.value = await store.fetchVersions(props.workflow.id);
  } catch {
    error.value = "Failed to load version history.";
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.open, (open) => {
  if (open) void load();
});

function versionReasonLabel(reason: string): string {
  return reason === "restore" ? "Snapshot before a restore" : "Snapshot before an edit";
}

// Lightweight, index-based diff — a step inserted mid-chain shifts every
// row after it and shows as "changed" rather than "added", but it answers
// the question this UI needs without a diff library (matches the original's
// summarizeStepsDiff, WorkflowRunModals.jsx:522-537).
function summarizeStepsDiff(oldSteps: any[] = [], newSteps: any[] = []) {
  const a = oldSteps || [];
  const b = newSteps || [];
  const maxLen = Math.max(a.length, b.length);
  const rows: Array<{ i: number; kind: "added" | "removed" | "changed"; label?: string; from?: string; to?: string }> = [];
  for (let i = 0; i < maxLen; i++) {
    const from = a[i];
    const to = b[i];
    if (!from && to) rows.push({ i, kind: "added", label: to.name || to.type });
    else if (from && !to) rows.push({ i, kind: "removed", label: from.name || from.type });
    else if (from.type !== to.type || from.name !== to.name) rows.push({ i, kind: "changed", from: from.name || from.type, to: to.name || to.type });
  }
  return rows;
}
const DIFF_COLOR: Record<string, string> = { added: SUCCESS, removed: DANGER, changed: WARNING };

async function restore(version: WorkflowVersion) {
  if (!props.workflow) return;
  if (!confirm(`Restore "${props.workflow.name}" to its state from ${new Date(version.createdAt).toLocaleString()}? The current version will itself be saved to history first.`)) return;
  restoringId.value = version.id;
  try {
    await store.restoreVersion(props.workflow.id, version.id);
    emit("restored");
    emit("close");
  } catch {
    error.value = "Failed to restore this version.";
  } finally {
    restoringId.value = null;
  }
}
</script>

<template>
  <Modal :open="open" :title="workflow ? `Version history — ${workflow.name}` : 'Version history'" size="lg" @close="emit('close')">
    <div v-if="isLoading" class="flex items-center justify-center py-8"><Spinner /></div>
    <p v-else-if="error" class="text-xs text-center py-6" :style="{ color: DANGER }">{{ error }}</p>
    <EmptyState
      v-else-if="versions.length === 0"
      title="No history yet"
      description="A snapshot is saved automatically every time this workflow is edited or restored."
    />
    <div v-else class="space-y-2">
      <div v-for="v in versions" :key="v.id" class="rounded-lg p-3 border border-gray-200">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900">{{ versionReasonLabel(v.reason) }}</p>
            <p class="text-xs mt-0.5 text-gray-400">
              {{ new Date(v.createdAt).toLocaleString() }} · {{ v.createdBy || "unknown" }} · {{ (v.snapshot as any)?.steps?.length || 0 }} step{{ ((v.snapshot as any)?.steps?.length || 0) === 1 ? "" : "s" }}
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button class="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700" @click="diffOpenId = diffOpenId === v.id ? null : v.id">
              {{ diffOpenId === v.id ? "Hide changes" : "Show changes" }}
            </button>
            <Button size="sm" variant="secondary" :loading="restoringId === v.id" @click="restore(v)">
              <component :is="ICONS.RestartCircle" :size="12" weight="Linear" /> Restore
            </Button>
          </div>
        </div>
        <div v-if="diffOpenId === v.id" class="mt-2 space-y-1">
          <p v-if="summarizeStepsDiff((v.snapshot as any)?.steps, workflow?.steps).length === 0" class="text-xs text-gray-400">No step differences vs the current version (only name/description may differ).</p>
          <p v-for="(r, idx) in summarizeStepsDiff((v.snapshot as any)?.steps, workflow?.steps)" :key="idx" class="text-xs" :style="{ color: DIFF_COLOR[r.kind] }">
            <template v-if="r.kind === 'added'">+ Step {{ r.i + 1 }} added: {{ r.label }}</template>
            <template v-else-if="r.kind === 'removed'">− Step {{ r.i + 1 }} removed: {{ r.label }}</template>
            <template v-else>~ Step {{ r.i + 1 }} changed: {{ r.from }} → {{ r.to }}</template>
          </p>
        </div>
      </div>
    </div>
  </Modal>
</template>
