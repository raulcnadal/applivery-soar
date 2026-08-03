<script setup lang="ts">
// Create/edit a Script or OMA-URI library entry. Script entries pick an
// existing Applivery script Asset by search (main.py:8451-8469); OMA-URI
// entries are a raw one-off SyncML command (windows-only).
import { Alert, Button, Modal, Input } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useActionLibraryStore, type ActionLibraryEntry } from "../../stores/actionLibrary";
import { useScriptAssetsStore, type ScriptAssetSummary } from "../../stores/scriptAssets";

const props = defineProps<{ open: boolean; entry: ActionLibraryEntry | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useActionLibraryStore();
const scriptAssetsStore = useScriptAssetsStore();

// Input's v-model only accepts string|number|undefined (no null), so this
// local form keeps every field as a plain string — "" standing in for the
// original's `null` — and converts back to null on save (setFieldNullable).
interface EntryForm {
  type: "script" | "oma_uri";
  name: string;
  description: string;
  platform: string;
  assetId: string;
  assetName: string;
  arguments: string;
  scope: string;
  path: string;
  action: string;
  format: string;
  value: string;
}

const form = reactive<EntryForm>({
  type: "script", name: "", description: "", platform: "windows",
  assetId: "", assetName: "", arguments: "", scope: "machine",
  path: "", action: "Replace", format: "chr", value: "",
});
const searchText = ref("");
const searchResults = ref<ScriptAssetSummary[]>([]);
const isSaving = ref(false);
const saveError = ref<string | null>(null);

watch(() => props.open, async (open) => {
  if (!open) return;
  const e = props.entry;
  Object.assign(form, {
    type: e?.type ?? "script", name: e?.name ?? "", description: e?.description ?? "",
    platform: e?.platform ?? "windows", assetId: e?.assetId ?? "", assetName: e?.assetName ?? "",
    arguments: e?.arguments ?? "", scope: e?.scope ?? "machine",
    path: e?.path ?? "", action: e?.action ?? "Replace", format: e?.format ?? "chr", value: e?.value ?? "",
  });
  searchText.value = "";
  searchResults.value = [];
  saveError.value = null;
});

async function runSearch() {
  if (!searchText.value.trim() || (form.platform !== "windows" && form.platform !== "macos")) return;
  searchResults.value = await scriptAssetsStore.search(form.platform, searchText.value);
}

function pickAsset(a: ScriptAssetSummary) {
  form.assetId = a.id;
  form.assetName = a.name;
  if (!form.name) form.name = a.name;
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    if (props.entry) await store.updateEntry(props.entry.id, form);
    else await store.createEntry(form);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save library entry.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="entry ? `Edit “${entry.name}”` : 'New library entry'" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>

      <Input
        :model-value="form.type"
        type="select"
        :options="[{ value: 'script', label: 'Script (Applivery Asset pointer)' }, { value: 'oma_uri', label: 'OMA-URI (raw Windows command)' }]"
        label="Entry type"
        @update:model-value="form.type = $event as any"
      />
      <Input v-model="form.name" label="Name" placeholder="What shows up in the workflow step picker" />
      <Input v-model="form.description" label="Description (optional)" />

      <template v-if="form.type === 'script'">
        <Input
          :model-value="form.platform"
          type="select"
          :options="[{ value: 'windows', label: 'Windows' }, { value: 'macos', label: 'macOS' }]"
          label="Platform"
          @update:model-value="form.platform = $event as string"
        />
        <div class="flex items-center gap-2">
          <Input v-model="searchText" placeholder="Search Applivery script Assets by name" class="flex-1" @keyup.enter="runSearch" />
          <Button size="sm" variant="secondary" @click="runSearch">Search</Button>
        </div>
        <div v-if="searchResults.length" class="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
          <button
            v-for="a in searchResults"
            :key="a.id"
            type="button"
            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            :class="{ 'bg-brand-50': form.assetId === a.id }"
            @click="pickAsset(a)"
          >
            {{ a.name }} <span class="text-xs text-gray-400">{{ a.description }}</span>
          </button>
        </div>
        <p v-if="form.assetId" class="text-xs text-gray-500">Selected: {{ form.assetName || form.assetId }}</p>
        <Input v-model="form.arguments" label="Arguments (optional — supports {{ device.x }}/{{ user.x }}, Applivery-resolved)" />
        <Input
          :model-value="form.scope"
          type="select"
          :options="[{ value: 'machine', label: 'Machine' }, { value: 'user', label: 'User' }]"
          label="Scope"
          @update:model-value="form.scope = $event as string"
        />
      </template>

      <template v-else>
        <p class="text-xs text-gray-500">OMA-URI entries always target Windows and send a raw SyncML command directly (customOmaUri) — bypasses Applivery's Policy pipeline entirely.</p>
        <Input v-model="form.path" label="OMA-URI path" placeholder="./Device/Vendor/MSFT/..." />
        <div class="grid grid-cols-2 gap-2">
          <Input
            :model-value="form.action"
            type="select"
            :options="['Add', 'Replace', 'Delete', 'Exec', 'Get', 'Copy'].map((a) => ({ value: a, label: a }))"
            label="Action"
            @update:model-value="form.action = $event as string"
          />
          <Input
            :model-value="form.format"
            type="select"
            :options="['chr', 'int', 'bool', 'xml', 'b64', 'bin', 'node', 'null', 'date', 'time', 'float'].map((f) => ({ value: f, label: f }))"
            label="Format"
            @update:model-value="form.format = $event as string"
          />
        </div>
        <Input v-model="form.value" label="Value (optional — supports {{ device.x }} templating)" />
      </template>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" @click="save">{{ entry ? "Save changes" : "Add to library" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
