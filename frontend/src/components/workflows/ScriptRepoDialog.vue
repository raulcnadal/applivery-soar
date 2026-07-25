<script setup lang="ts">
// Connect a new Git script repo. Port of main.py:8733-8756 (ScriptRepoPayload/create_script_repo).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useScriptReposStore } from "../../stores/scriptRepos";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useScriptReposStore();
const form = reactive({ name: "", owner: "", repo: "", branch: "main", path: "" });
const isSaving = ref(false);
const saveError = ref<string | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { name: "", owner: "", repo: "", branch: "main", path: "" });
  saveError.value = null;
});

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    await store.createRepo(form);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to connect repo.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="Connect a script repo" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" placeholder="e.g. Applivery MDM Scripts" />
      <div class="grid grid-cols-2 gap-2">
        <Input v-model="form.owner" label="Owner" placeholder="applivery" />
        <Input v-model="form.repo" label="Repo" placeholder="applivery-mdm-scripts" />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <Input v-model="form.branch" label="Branch" placeholder="main" />
        <Input v-model="form.path" label="Starting path (optional)" placeholder="macOS or scripts/windows" />
      </div>
      <p class="text-xs text-gray-500">Public repos need no authentication. Sets GITHUB_TOKEN on the server for a higher rate limit if you connect several repos.</p>
      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!form.name || !form.owner || !form.repo" @click="save">Connect</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
