<script setup lang="ts">
// Port of WorkflowPickerModal (WorkflowRunModals.jsx:243-267) — shared by the
// fleet table's bulk bar and the device drawer's "Run workflow" button.
import { Modal } from "@applivery/bluesky-vue";
import { onMounted } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useWorkflowsStore, type Workflow } from "../../stores/workflows";

const PRIMARY_BLUE = "#0241E3";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; confirm: [workflow: Workflow] }>();

const store = useWorkflowsStore();

onMounted(() => {
  if (store.workflows.length === 0) store.fetchWorkflows();
});
</script>

<template>
  <Modal :open="open" title="Choose a workflow to run" size="md" @close="emit('close')">
    <div class="space-y-1 -mx-2">
      <button
        v-for="wf in store.workflows"
        :key="wf.id"
        class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors hover:bg-gray-50"
        @click="emit('confirm', wf)"
      >
        <component :is="ICONS.Play" :size="14" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
        <div class="min-w-0">
          <p class="font-medium truncate text-gray-900">{{ wf.name }}</p>
          <p class="text-[11px] truncate text-gray-400">{{ wf.steps?.length || 0 }} step{{ wf.steps?.length === 1 ? "" : "s" }}</p>
        </div>
      </button>
      <p v-if="store.workflows.length === 0" class="text-xs text-center py-6 text-gray-400">
        No workflows yet — create one from the Workflows tab first.
      </p>
    </div>
  </Modal>
</template>
