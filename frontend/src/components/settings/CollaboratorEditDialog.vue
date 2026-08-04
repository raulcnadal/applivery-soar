<script setup lang="ts">
// Edit a collaborator's Applivery role/tags directly — writes straight to
// Applivery (docs/settings.md#roles' "Collaborators & Tags" sub-view).
//
// Deliberately NOT a <Modal> — same reasoning as RoleDialog.vue: the
// original's CollaboratorsPanel (RolesSettings.jsx) expands this inline
// (within the collaborator's own row card) rather than behind an overlay.
// This port renders it inline in RolesSettingsPanel.vue's content area
// instead (swapping out the collaborators table, same pattern RoleDialog
// uses for the Roles list) rather than reproducing the original's exact
// per-row expansion, which would need restructuring
// CollaboratorsDirectoryTable.vue itself — but it fixes the same
// underlying bug: a Modal-wrapped dialog rendering behind SettingsModal's
// own overlay is never going to look right regardless of z-index, since
// the original never puts this behind an overlay at all.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useRolesStore, type Collaborator } from "../../stores/roles";

const props = defineProps<{ collaborator: Collaborator | null }>();
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

watch(
  () => props.collaborator,
  (c) => {
    form.role = c?.role_normalized || "unassigned";
    form.tags = (c?.tagCandidates ?? []).join(", ");
    saveError.value = null;
  },
  { immediate: true },
);

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
  <div>
    <h3 class="text-sm font-bold mb-4 text-gray-900 dark:text-white">Edit {{ emailOf(collaborator) }}</h3>
    <div class="p-5 rounded-xl border shadow-sm max-w-3xl border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3">
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
  </div>
</template>
