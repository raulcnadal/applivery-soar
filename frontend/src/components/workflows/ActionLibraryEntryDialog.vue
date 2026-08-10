<script setup lang="ts">
// Create/edit a Script or OMA-URI library entry. Port of EntryForm
// (ActionLibraryView.jsx:57-320). Script entries either pick an existing
// Applivery script Asset (debounced search or a pasted Asset id) or write
// brand-new script content that gets uploaded as a new Asset on save;
// OMA-URI entries are a raw one-off SyncML command (windows-only).
import { Alert, Button, Modal, Input } from "@applivery/bluesky-vue";
import { computed, reactive, ref, watch } from "vue";
import { useActionLibraryStore, type ActionLibraryEntry } from "../../stores/actionLibrary";
import { useScriptAssetsStore, type ScriptAssetSummary } from "../../stores/scriptAssets";

const PRIMARY_BLUE = "#0241E3";

// Applivery interpolates these itself in script `arguments` at execution
// time (docs.applivery.com/.../scripts) — a narrower set than DEVICE_VARS
// below, which is this app's OWN local {{ device.x }} templating used only
// for OMA-URI's `value`. Pre-quoted since Applivery splits arguments on
// whitespace.
const SCRIPT_VARS = ["device.id", "device.displayName", "device.serialNumber", "device.osVersion", "device.chip", "device.hostName", "user.id", "user.email", "user.name"];
const DEVICE_VARS = ["device.displayName", "device.serialNumber", "device.osVersion", "device.manufacturer", "device.model", "device.udid", "device.mdmUser.email", "device.mdmUser.name"];
const SCRIPT_TEMPLATE: Record<string, string> = { windows: "# PowerShell\n", macos: "#!/bin/bash\n" };
// A literal "}}" inside a template string breaks the SFC compiler's mustache
// tokenizer (it closes on the first "}}" it finds, inside the string) — see
// ActionLibraryTable.vue's deviceTemplateExample comment. Keep it a plain
// identifier instead.
const deviceXTemplateExample = "{{ device.x }}";

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
const isEditing = computed(() => !!props.entry);
const scriptMode = ref<"existing" | "new">("existing"); // only offered when creating a brand-new entry
const newScriptContent = ref("");
const exposeToChildren = ref(true);

const searchText = ref("");
const searchResults = ref<ScriptAssetSummary[]>([]);
const isSearching = ref(false);
const searchError = ref<string | null>(null);
const manualAssetId = ref("");

const isSaving = ref(false);
const saveError = ref<string | null>(null);

// View/edit an existing entry's Applivery Asset content — a simplified,
// inline version of ScriptContentModal (kept in-dialog rather than a
// separate modal component).
const contentOpen = ref(false);
const contentLoading = ref(false);
const contentText = ref("");
const contentError = ref<string | null>(null);
const contentSaving = ref(false);
const contentSaved = ref<{ name: string } | null>(null);

watch(() => props.open, async (open) => {
  if (!open) return;
  const e = props.entry;
  Object.assign(form, {
    type: e?.type ?? "script", name: e?.name ?? "", description: e?.description ?? "",
    platform: e?.platform ?? "windows", assetId: e?.assetId ?? "", assetName: e?.assetName ?? "",
    arguments: e?.arguments ?? "", scope: e?.scope ?? "machine",
    path: e?.path ?? "", action: e?.action ?? "Replace", format: e?.format ?? "chr", value: e?.value ?? "",
  });
  scriptMode.value = "existing";
  newScriptContent.value = SCRIPT_TEMPLATE[form.platform] || "";
  exposeToChildren.value = true;
  searchText.value = "";
  searchResults.value = [];
  searchError.value = null;
  manualAssetId.value = "";
  saveError.value = null;
  contentOpen.value = false;
  contentSaved.value = null;
});

// Port of the 350ms debounced Asset search (ActionLibraryView.jsx:80-95) —
// only fires once at least 2 characters are typed.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch([searchText, () => form.platform], () => {
  if (searchTimer) clearTimeout(searchTimer);
  if (form.type !== "script" || searchText.value.trim().length < 2) {
    searchResults.value = [];
    searchError.value = null;
    return;
  }
  searchTimer = setTimeout(async () => {
    isSearching.value = true;
    searchError.value = null;
    try {
      searchResults.value = await scriptAssetsStore.search(form.platform as "windows" | "macos", searchText.value.trim());
      if (scriptAssetsStore.error) searchError.value = scriptAssetsStore.error;
    } catch (err: any) {
      searchResults.value = [];
      searchError.value = err?.response?.data?.detail || "Search failed";
    } finally {
      isSearching.value = false;
    }
  }, 350);
});

watch(() => form.platform, (platform) => {
  if (!isEditing.value) newScriptContent.value = SCRIPT_TEMPLATE[platform] || "";
});

function pickAsset(a: ScriptAssetSummary) {
  form.assetId = a.id;
  form.assetName = a.name;
  searchText.value = "";
  searchResults.value = [];
}
function clearAsset() {
  form.assetId = "";
  form.assetName = "";
}
function useManualAssetId() {
  if (!manualAssetId.value.trim()) return;
  form.assetId = manualAssetId.value.trim();
  form.assetName = "";
  manualAssetId.value = "";
}
function insertArgVar(v: string) {
  form.arguments = `${form.arguments || ""}"{{${v}}}"`;
}
function insertValueVar(v: string) {
  form.value = `${form.value || ""}{{ ${v} }}`;
}
// A literal "{{"/"}}" inside a mustache expression's own source (e.g.
// `{{ \`{{${v}}}\` }}`) confuses the SFC compiler's tokenizer the same way
// deviceXTemplateExample above does — build the button labels here instead.
function argVarLabel(v: string): string {
  return `{{${v}}}`;
}
function valueVarLabel(v: string): string {
  return `{{ ${v} }}`;
}

async function toggleContent() {
  contentOpen.value = !contentOpen.value;
  contentSaved.value = null;
  if (contentOpen.value && form.assetId) {
    contentLoading.value = true;
    contentError.value = null;
    try {
      const res = await scriptAssetsStore.getContent(form.assetId);
      contentText.value = res.content;
    } catch (err: any) {
      contentError.value = err?.response?.data?.detail || "Could not load script content.";
    } finally {
      contentLoading.value = false;
    }
  }
}
async function saveContent() {
  contentSaving.value = true;
  contentError.value = null;
  try {
    const res = await scriptAssetsStore.editAsset(form.assetId, { platform: form.platform as "windows" | "macos", content: contentText.value });
    form.assetId = res.asset.id;
    form.assetName = res.asset.name;
    contentSaved.value = res.asset;
  } catch (err: any) {
    contentError.value = err?.response?.data?.detail || "Save failed";
  } finally {
    contentSaving.value = false;
  }
}

const canSave = computed(() => {
  if (isSaving.value || !form.name.trim()) return false;
  if (form.type === "oma_uri") return !!form.path.trim();
  return scriptMode.value === "existing" || isEditing.value ? !!form.assetId : !!newScriptContent.value.trim();
});

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    let payload: EntryForm = { ...form };
    if (form.type === "script" && !isEditing.value && scriptMode.value === "new") {
      const asset = await scriptAssetsStore.createAsset({
        name: form.name, description: form.description, platform: form.platform as "windows" | "macos",
        content: newScriptContent.value, exposeToChildren: exposeToChildren.value,
      });
      payload = { ...payload, assetId: asset.id, assetName: asset.name };
    }
    if (props.entry) await store.updateEntry(props.entry.id, payload);
    else await store.createEntry(payload);
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
        :disabled="isEditing"
        :options="[{ value: 'script', label: 'Script (Applivery Asset pointer)' }, { value: 'oma_uri', label: 'OMA-URI (raw Windows command)' }]"
        label="Entry type"
        @update:model-value="form.type = $event as any"
      />
      <Input v-model="form.name" label="Name" placeholder="What shows up in the workflow step picker" />
      <Input v-model="form.description" label="Description (optional)" />

      <template v-if="form.type === 'script'">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Runs a script Asset directly on the device — no Policy assignment involved. Scripts live in Applivery's own Assets library; search below to find one already uploaded, or write a new one.
        </p>
        <Input
          :model-value="form.platform"
          type="select"
          :disabled="form.type !== 'script'"
          :options="[{ value: 'windows', label: 'Windows' }, { value: 'macos', label: 'macOS' }]"
          label="Platform"
          @update:model-value="form.platform = $event as string; form.assetId = ''; form.assetName = ''"
        />

        <div v-if="!isEditing" class="flex gap-1.5 p-0.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          <button
            v-for="[k, label] in [['existing', 'Pick existing script'], ['new', 'Write new script']] as const"
            :key="k"
            type="button"
            class="flex-1 py-1 rounded-md text-[11px] font-medium transition-colors"
            :class="scriptMode === k ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
            @click="scriptMode = k"
          >
            {{ label }}
          </button>
        </div>

        <template v-if="isEditing || scriptMode === 'existing'">
          <template v-if="!form.assetId">
            <Input v-model="searchText" :label="`Search ${form.platform === 'windows' ? 'Windows' : 'macOS'} script Assets`" placeholder="Script name…" />
            <p v-if="isSearching" class="text-[10px] text-gray-400">Searching…</p>
            <p v-if="searchError" class="text-[10px] text-red-500">{{ searchError }}</p>
            <div v-if="searchResults.length" class="rounded-lg border border-gray-200 dark:border-gray-700 max-h-36 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
              <button v-for="a in searchResults" :key="a.id" type="button" class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-white/5 text-xs text-gray-900 dark:text-white" @click="pickAsset(a)">
                <span class="truncate flex-1">{{ a.name }}</span>
              </button>
            </div>
            <div class="flex gap-1.5">
              <Input v-model="manualAssetId" placeholder="Or paste an Asset ID directly" class="flex-1" />
              <Button size="sm" :disabled="!manualAssetId.trim()" @click="useManualAssetId">Use</Button>
            </div>
          </template>
          <div v-else class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
            <span class="text-xs flex-1 truncate text-gray-900 dark:text-white">{{ form.assetName || form.assetId }}</span>
            <span class="text-[9px] font-mono truncate max-w-[35%] text-gray-400">{{ form.assetId }}</span>
            <button v-if="isEditing" type="button" class="text-[10px] px-1.5" :style="{ color: PRIMARY_BLUE }" @click="toggleContent">{{ contentOpen ? "Hide content" : "Content" }}</button>
            <button type="button" class="text-[10px] px-1.5 text-red-500" @click="clearAsset">Clear</button>
          </div>

          <div v-if="contentOpen" class="space-y-2 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
            <p v-if="contentLoading" class="text-[10px] text-gray-400">Loading…</p>
            <template v-else>
              <p v-if="contentError" class="text-[10px] text-red-500">{{ contentError }}</p>
              <div v-if="contentSaved" class="text-[10px]" :style="{ color: PRIMARY_BLUE }">Saved as "{{ contentSaved.name }}" — a new Applivery Asset version. Content editing repoints this entry automatically.</div>
              <textarea v-else v-model="contentText" rows="10" class="w-full px-2.5 py-2 rounded-lg text-xs font-mono outline-none resize-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              <div v-if="!contentSaved" class="flex items-center justify-between gap-2">
                <p class="text-[10px] text-gray-400">Saves as a new Asset version — the old one is deleted and repointed automatically.</p>
                <Button size="sm" :loading="contentSaving" :disabled="!contentText.trim()" @click="saveContent">Save as new version</Button>
              </div>
            </template>
          </div>
        </template>

        <template v-if="!isEditing && scriptMode === 'new'">
          <Input v-model="newScriptContent" type="textarea" :rows="8" :label="`New ${form.platform === 'windows' ? 'Windows' : 'macOS'} script content`" />
          <label class="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-200">
            <input v-model="exposeToChildren" type="checkbox" /> Expose to child segments
          </label>
          <p class="text-[10px] leading-relaxed text-gray-400">Saving uploads this as a new script Asset on Applivery under the Global segment, then adds it to the library. Leave "Expose to child segments" on so it's usable on workflows targeting devices in any segment.</p>
        </template>

        <Input v-model="form.arguments" type="textarea" :rows="2" label="Arguments (optional)" placeholder='e.g. --label "My Application" "{{ user.name }}"' />
        <div class="flex flex-wrap gap-1">
          <button v-for="v in SCRIPT_VARS" :key="v" type="button" class="text-[9px] px-1.5 py-0.5 rounded font-mono" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }" @click="insertArgVar(v)">{{ argVarLabel(v) }}</button>
        </div>
        <p class="text-[10px] leading-relaxed text-gray-400">
          Applivery splits Arguments on whitespace and resolves these variables itself when the script runs — wrap multi-word values and variables in double quotes to keep them as one parameter, and escape a literal backslash or quote with <code>\</code>.
        </p>

        <Input
          :model-value="form.scope"
          type="select"
          :options="[{ value: 'machine', label: 'Machine (system-level)' }, { value: 'user', label: 'User (current session)' }]"
          label="Execution scope"
          @update:model-value="form.scope = $event as string"
        />
      </template>

      <template v-else>
        <p class="text-xs text-gray-500 dark:text-gray-400">A direct, one-off Windows CSP command (not part of a Policy). The Value field supports {{ deviceXTemplateExample }} variables, resolved right before the command is sent.</p>
        <Input v-model="form.path" label="OMA-URI / CSP path" placeholder="./Vendor/MSFT/Policy/Config/..." />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        <Input v-model="form.value" label="Value (optional)" placeholder="e.g. {{ device.serialNumber }}" />
        <div class="flex flex-wrap gap-1">
          <button v-for="v in DEVICE_VARS" :key="v" type="button" class="text-[9px] px-1.5 py-0.5 rounded font-mono" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }" @click="insertValueVar(v)">{{ valueVarLabel(v) }}</button>
        </div>
      </template>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!canSave" @click="save">{{ entry ? "Save changes" : "Add to library" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
