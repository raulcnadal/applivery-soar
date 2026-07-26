<script setup lang="ts">
// Edit a collaborator's Applivery role/tags directly — writes straight to
// Applivery (docs/settings.md#roles' "Collaborators & Tags" sub-view).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useRolesStore, type Collaborator } from "../../stores/roles";

const props = defineProps<{ open: boolean; collaborator: Collaborator | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useRolesStore();

// Applivery's own fixed 5-value Collaborator role enum (ARCHITECTURE.md
// §rbac.middleware.ts doc comment).
const ROLE_OPTIONS = ["owner", "admin", "editor", "viewer", "unassigned"].map((r) => ({ value: r, label: r }));

const form = reactive({ role: "unassigned", tags: "" });
const isSaving = ref(false);
const saveError = ref<string | null>(null);

function idOf(c: Collaborator | null): string {
  return String(c?.id ?? c?._id ?? "");
}
function emailOf(c: Collaborator | null): string {
  return String(c?.email ?? (c as any)?.user?.email ?? "");
}

watch(() => props.open, (open) => {
  if (!open) return;
  const c = props.collaborator;
  form.role = c?.role_normalized || "unassigned";
  form.tags = (c?.tagCandidates ?? []).join(", ");
  saveError.value = null;
});

async function save() {
  if (!props.collaborator) return;
  isSaving.value = true;
  saveError.value = null;
  try {
    await store.updateCollaboratorTags(idOf(props.collaborator), {
      role: form.role,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to update collaborator.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="`Edit ${emailOf(collaborator)}`" size="md" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <p class="text-xs text-gray-400">Changes here write straight to Applivery — the same effect as editing this collaborator in Applivery's own console.</p>
      <Input
        :model-value="form.role"
        type="select"
        :options="ROLE_OPTIONS"
        label="Applivery role"
        @update:model-value="form.role = $event as string"
      />
      <Input v-model="form.tags" label="Tags (comma-separated)" placeholder="soc-analyst, tier2" />
      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" @click="save">Save changes</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
