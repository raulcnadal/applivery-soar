<script setup lang="ts">
// Create/edit a Case Auto-Run rule. Port of CaseAutoRunRulePayload
// (main.py:12490-12509).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useCasesStore, type CaseAutoRunRule } from "../../stores/cases";
import { useWorkflowsStore } from "../../stores/workflows";

const props = defineProps<{ open: boolean; rule: CaseAutoRunRule | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useCasesStore();
const workflowsStore = useWorkflowsStore();

const form = reactive({
  name: "", enabled: true, minSeverity: "high", mitreTechniques: "", workflowId: "",
  autoRunDestructiveAck: false, maxFiresPerHour: 10,
});
const isSaving = ref(false);
const saveError = ref<string | null>(null);

onMounted(async () => {
  if (workflowsStore.workflows.length === 0) await workflowsStore.fetchWorkflows();
});

watch(() => props.open, (open) => {
  if (!open) return;
  const r = props.rule;
  Object.assign(form, {
    name: r?.name ?? "", enabled: r?.enabled ?? true, minSeverity: r?.minSeverity ?? "high",
    mitreTechniques: (r?.mitreTechniques ?? []).join(", "), workflowId: r?.workflowId ?? "",
    autoRunDestructiveAck: r?.autoRunDestructiveAck ?? false, maxFiresPerHour: r?.maxFiresPerHour ?? 10,
  });
  saveError.value = null;
});

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = {
      name: form.name, enabled: form.enabled, minSeverity: form.minSeverity,
      mitreTechniques: form.mitreTechniques.split(",").map((t) => t.trim()).filter(Boolean),
      workflowId: form.workflowId, autoRunDestructiveAck: form.autoRunDestructiveAck, maxFiresPerHour: form.maxFiresPerHour,
    };
    if (props.rule) await store.updateAutoRunRule(props.rule.id, payload);
    else await store.createAutoRunRule(payload);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save rule.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="rule ? `Edit “${rule.name}”` : 'New Case Auto-Run rule'" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" />
      <Input
        :model-value="form.minSeverity"
        type="select"
        :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))"
        label="Minimum severity to match"
        @update:model-value="form.minSeverity = $event as string"
      />
      <Input v-model="form.mitreTechniques" label="MITRE technique ids (comma-separated, optional)" placeholder="T1078, T1566" />
      <Input
        :model-value="form.workflowId"
        type="select"
        :options="workflowsStore.workflows.map((w) => ({ value: w.id, label: w.name }))"
        label="Workflow to run"
        @update:model-value="form.workflowId = $event as string"
      />
      <Input v-model.number="form.maxFiresPerHour" type="number" label="Max fires per hour" />
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.enabled" /> Enabled</label>
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.autoRunDestructiveAck" /> I acknowledge this workflow may contain a destructive action</label>
      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!form.name || !form.workflowId" @click="save">{{ rule ? "Save changes" : "Create rule" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
