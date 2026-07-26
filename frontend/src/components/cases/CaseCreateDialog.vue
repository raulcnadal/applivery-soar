<script setup lang="ts">
// Manual Case creation — port of CaseCreatePayload (main.py:11938-11944).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useCasesStore } from "../../stores/cases";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const store = useCasesStore();

const form = reactive({ title: "", severity: "medium", deviceId: "", deviceName: "", notes: "" });
const isSaving = ref(false);
const saveError = ref<string | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { title: "", severity: "medium", deviceId: "", deviceName: "", notes: "" });
  saveError.value = null;
});

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    await store.createCase({
      title: form.title, severity: form.severity,
      deviceId: form.deviceId || null, deviceName: form.deviceName || null,
      notes: form.notes || null,
    });
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
  <Modal :open="open" title="New case" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.title" label="Title" placeholder="What's going on?" />
      <Input
        :model-value="form.severity"
        type="select"
        :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))"
        label="Severity"
        @update:model-value="form.severity = $event as string"
      />
      <div class="grid grid-cols-2 gap-2">
        <Input v-model="form.deviceId" label="Device id (optional)" />
        <Input v-model="form.deviceName" label="Device name (optional, label only)" />
      </div>
      <Input v-model="form.notes" type="textarea" label="Initial note (optional)" placeholder="Paste any IOCs here — they'll auto-enrich if Threat Intel is configured" />
      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!form.title" @click="save">Create case</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
