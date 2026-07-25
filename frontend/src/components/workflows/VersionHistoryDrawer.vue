<script setup lang="ts">
// Version history — every pre-update/pre-restore snapshot of a workflow's
// editable definition, most recent first (capped at 50 per workflow). Port
// of the original's version list/restore drawer.
import { Button, Drawer, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { ref, watch } from "vue";
import { useWorkflowsStore, type Workflow, type WorkflowVersion } from "../../stores/workflows";

const props = defineProps<{ open: boolean; workflow: Workflow | null }>();
const emit = defineEmits<{ close: []; restored: [] }>();

const store = useWorkflowsStore();
const versions = ref<WorkflowVersion[]>([]);
const isLoading = ref(false);
const restoringId = ref<string | null>(null);

async function load() {
  if (!props.workflow) return;
  isLoading.value = true;
  try {
    versions.value = await store.fetchVersions(props.workflow.id);
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.open, (open) => {
  if (open) void load();
});

async function restore(version: WorkflowVersion) {
  if (!props.workflow) return;
  if (!confirm(`Restore "${props.workflow.name}" to its state from ${new Date(version.createdAt).toLocaleString()}? The current state is snapshotted first, so this is itself undoable.`)) return;
  restoringId.value = version.id;
  try {
    await store.restoreVersion(props.workflow.id, version.id);
    emit("restored");
    await load();
  } finally {
    restoringId.value = null;
  }
}
</script>

<template>
  <Drawer :open="open" :title="workflow ? `Version history — ${workflow.name}` : 'Version history'" width="w-[480px]" @close="emit('close')">
    <div class="space-y-3">
      <div v-for="v in versions" :key="v.id" class="border border-gray-200 rounded-lg p-3">
        <div class="flex items-center justify-between">
          <StatusPill :label="v.reason" :color="v.reason === 'restore' ? 'orange' : 'gray'" />
          <p class="text-xs text-gray-400">{{ new Date(v.createdAt).toLocaleString() }}</p>
        </div>
        <p class="text-xs text-gray-500 mt-1">{{ v.createdBy || "unknown" }} · {{ (v.snapshot as any)?.steps?.length ?? 0 }} step(s)</p>
        <Button size="sm" variant="secondary" class="mt-2" :loading="restoringId === v.id" @click="restore(v)">Restore this version</Button>
      </div>
      <EmptyState v-if="!isLoading && versions.length === 0" title="No previous versions" description="A version is snapshotted automatically every time this workflow is edited or restored." />
    </div>
  </Drawer>
</template>
