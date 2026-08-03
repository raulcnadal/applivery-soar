<script setup lang="ts">
// Create/edit a Trigger. Port of main.py:12692-12756 (TriggerPayload/create_trigger/update_trigger).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useTriggersStore, type Trigger } from "../../stores/triggers";
import { useWorkflowsStore } from "../../stores/workflows";

const props = defineProps<{ open: boolean; trigger: Trigger | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useTriggersStore();
const workflowsStore = useWorkflowsStore();

const form = reactive({
  name: "", description: "", workflowId: "", enabled: true,
  openCase: false, caseSeverity: "medium", deviceLookupField: "",
});
const isSaving = ref(false);
const saveError = ref<string | null>(null);

onMounted(async () => {
  if (workflowsStore.workflows.length === 0) await workflowsStore.fetchWorkflows();
});

watch(() => props.open, (open) => {
  if (!open) return;
  const t = props.trigger;
  Object.assign(form, {
    name: t?.name ?? "", description: t?.description ?? "", workflowId: t?.workflowId ?? "",
    enabled: t?.enabled ?? true, openCase: t?.openCase ?? false, caseSeverity: t?.caseSeverity ?? "medium",
    deviceLookupField: t?.deviceLookupField ?? "",
  });
  saveError.value = null;
});

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = { ...form, deviceLookupField: form.deviceLookupField || null };
    if (props.trigger) await store.updateTrigger(props.trigger.id, payload);
    else await store.createTrigger(payload);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save trigger.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="trigger ? `Edit “${trigger.name}”` : 'New trigger'" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" />
      <Input v-model="form.description" label="Description (optional)" />
      <Input
        :model-value="form.workflowId"
        type="select"
        :options="workflowsStore.workflows.map((w) => ({ value: w.id, label: w.name }))"
        label="Workflow to run"
        @update:model-value="form.workflowId = $event as string"
      />
      <Input v-model="form.deviceLookupField" label="Device lookup field (optional)" placeholder="e.g. serialNumber — matched against the inbound JSON body's same-named key" />
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" v-model="form.enabled" /> Enabled
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" v-model="form.openCase" /> Open a Case when this trigger fires
      </label>
      <Input
        v-if="form.openCase"
        :model-value="form.caseSeverity"
        type="select"
        :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))"
        label="Case severity"
        @update:model-value="form.caseSeverity = $event as string"
      />
      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!form.name || !form.workflowId" @click="save">{{ trigger ? "Save changes" : "Create trigger" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
