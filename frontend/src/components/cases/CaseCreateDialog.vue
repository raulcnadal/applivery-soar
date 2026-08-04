<script setup lang="ts">
// Manual Case creation — port of NewCaseModal (CasesView.jsx:575-628) and
// CaseCreatePayload (cases.schemas.ts). The original's manual-create form
// only has title/severity/an optional first note — no device fields (a
// manually-created case simply has no linked device), so this intentionally
// doesn't expose deviceId/deviceName inputs even though the backend schema
// accepts them (they're populated by the compliance-violation/webhook-
// trigger auto-create paths instead).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useCasesStore } from "../../stores/cases";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const store = useCasesStore();

const form = reactive({ title: "", severity: "medium", notes: "" });
const isSaving = ref(false);
const saveError = ref<string | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { title: "", severity: "medium", notes: "" });
  saveError.value = null;
});

async function save() {
  if (!form.title.trim()) return;
  isSaving.value = true;
  saveError.value = null;
  try {
    await store.createCase({ title: form.title.trim(), severity: form.severity, notes: form.notes.trim() || undefined });
    emit("created");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to create case.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="New Case" size="sm" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.title" label="Title" placeholder="e.g. Suspicious login pattern on finance laptops" />
      <Input
        :model-value="form.severity"
        type="select"
        :options="[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ]"
        label="Severity"
        @update:model-value="form.severity = $event as string"
      />
      <Input v-model="form.notes" type="textarea" label="Initial note (optional)" />
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button :loading="isSaving" :disabled="!form.title.trim()" @click="save">{{ isSaving ? "Creating…" : "Create Case" }}</Button>
      </div>
    </div>
  </Modal>
</template>
