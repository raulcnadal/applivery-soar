<script setup lang="ts">
// "Workspace Automation" tab (docs/settings.md#workspace-automation).
import { Alert, Button, Input, StatusPill } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useWorkspaceAutomationStore } from "../../stores/workspaceAutomation";

const store = useWorkspaceAutomationStore();
const tokenInput = ref("");
const selectedAttrName = ref<string>("");
const isSavingMapping = ref(false);
const mappingSaved = ref(false);
// Read-only by default: the saved mapping NAME (store.osPatchLevelSmartAttributeName,
// via the cheap, dedicated fetchOsPatchLevelMapping call) is shown directly
// as text, with no dependency on the Smart Attributes catalog list at all —
// see startEditingMapping's doc comment for why. Only flips to the <select>
// once the admin explicitly clicks "Change".
const isEditingMapping = ref(false);
// Fetched at most once per page visit — set the first time
// startEditingMapping's lazy fetchSmartAttributes() call resolves (success
// OR failure; either way there's no point retrying automatically on every
// subsequent click). A manual re-open of the editor after an error still
// re-fetches, since `smartAttributesLoaded` only flips true, never reset
// to false, on a completed attempt below — deliberately: retrying silently
// on every click would defeat the "reduce load on this flaky endpoint"
// point of making it lazy in the first place.
const smartAttributesLoaded = ref(false);

// Keeps selectedAttrName in sync with the saved mapping whenever it changes
// (initial load, or right after a successful save) — a plain watcher rather
// than a one-shot assignment, so it's correct regardless of when
// fetchOsPatchLevelMapping's await resolves relative to this component's
// own mount.
watch(
  () => store.osPatchLevelSmartAttributeName,
  (name) => {
    selectedAttrName.value = name ?? "";
  },
  { immediate: true },
);

onMounted(async () => {
  // fetchSmartAttributes() is deliberately NOT called here — see
  // startEditingMapping's doc comment. Both of these two are cheap,
  // dedicated, single-purpose reads (unlike the smart-attributes catalog,
  // a bulk Applivery API call documented elsewhere as flaky), so
  // Promise.allSettled is just defense-in-depth here, not load-bearing.
  await Promise.allSettled([store.fetchStatus(), store.fetchOsPatchLevelMapping()]);
});

async function saveToken() {
  if (!tokenInput.value.trim()) return;
  await store.setServiceAccountToken(tokenInput.value.trim());
  tokenInput.value = "";
}

async function removeCredential() {
  if (!confirm("Remove the automation credential for this workspace? Background jobs (compliance evaluation, scheduled reports, ticket sync, etc.) stop running for this workspace until reconfigured.")) return;
  await store.remove();
}

const mappingDirty = computed(() => selectedAttrName.value !== (store.osPatchLevelSmartAttributeName ?? ""));

// Opens the picker and lazily loads the Smart Attributes catalog — the
// currently-saved mapping is already visible without this call (see
// isEditingMapping's doc comment), so this heavier bulk fetch only ever
// runs when the admin is actually about to change the value, and at most
// once per page visit rather than on every mount. Previously this ran
// unconditionally in onMounted: a transient failure on this specific
// documented-flaky endpoint made an already-correctly-saved mapping look
// broken/reverted, purely because the DISPLAY depended on a fetch it never
// actually needed to depend on.
async function startEditingMapping() {
  isEditingMapping.value = true;
  mappingSaved.value = false;
  if (!smartAttributesLoaded.value) {
    await store.fetchSmartAttributes();
    smartAttributesLoaded.value = true;
  }
}
function cancelEditingMapping() {
  isEditingMapping.value = false;
  selectedAttrName.value = store.osPatchLevelSmartAttributeName ?? "";
}

async function saveMapping() {
  isSavingMapping.value = true;
  mappingSaved.value = false;
  try {
    await store.setOsPatchLevelMapping(selectedAttrName.value || null);
    mappingSaved.value = true;
    isEditingMapping.value = false;
  } finally {
    isSavingMapping.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-2xl">
    <p class="text-xs text-gray-400">
      Background jobs run with no human signed in, so unattended jobs (compliance evaluator, ticket sync, scheduled
      reports, and others) need a standing credential per workspace to keep calling Applivery's API. This uses an
      <strong>Applivery Service Account</strong> Bearer token — a static, workspace-scoped credential with no expiry
      or refresh cycle, purpose-built for exactly this. Create one from the
      <strong>Applivery Dashboard → Workspace Settings → Service Accounts</strong>, with the
      <strong>Admin</strong> role (background jobs need to read and act across devices, compliance, and cases).
      Copy the Bearer token shown right after creation — Applivery won't display it again.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-4 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">Status:</span>
        <StatusPill :label="store.status.configured ? 'Configured' : 'Not configured'" :color="store.status.configured ? 'green' : 'gray'" />
      </div>
      <p v-if="store.status.configured" class="text-sm text-gray-500 dark:text-gray-400">
        Set by {{ store.status.configuredBy || "unknown" }} on {{ store.status.configuredAt ? new Date(store.status.configuredAt).toLocaleString() : "—" }}.
        Last verified: {{ store.status.lastVerifiedAt ? new Date(store.status.lastVerifiedAt).toLocaleString() : "—" }}.
      </p>

      <Input v-model="tokenInput" type="password" label="Service Account Bearer token" placeholder="Paste the token here" />
      <div class="flex items-center gap-2 pt-1">
        <Button :loading="store.isSaving" :disabled="!tokenInput.trim()" @click="saveToken">Save</Button>
        <Button v-if="store.status.configured" variant="ghost" :loading="store.isSaving" @click="removeCredential">Remove</Button>
      </div>
    </div>

    <p class="text-xs text-gray-400 pt-2">
      OS Patch Level — if your Applivery workspace already populates a Smart Attribute with each device's patch/build
      level (Android SPL date, Apple version+build, Windows build), map it here once. Every CVE-matching connector
      (Android Security Bulletin, Apple Security Releases) and Compliance Policy's "OS Patch Level" condition then read
      it automatically — no per-connector configuration needed.
    </p>
    <Alert v-if="store.mappingError" type="danger">{{ store.mappingError }}</Alert>
    <Alert v-if="store.smartAttributesError" type="danger">{{ store.smartAttributesError }}</Alert>
    <Alert v-if="mappingSaved && !mappingDirty" type="success">Saved.</Alert>

    <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-4 space-y-3">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-200">OS Patch Level Smart Attribute</label>

      <!-- Read-only view — the saved mapping name shown directly, no
           dependency on the Smart Attributes catalog having loaded. -->
      <div v-if="!isEditingMapping" class="flex items-center justify-between gap-3">
        <p class="text-sm">
          <span v-if="store.osPatchLevelSmartAttributeName" class="font-mono text-gray-900 dark:text-white">{{ store.osPatchLevelSmartAttributeName }}</span>
          <span v-else class="text-gray-400">Not mapped — falls back to OS version only</span>
        </p>
        <Button variant="ghost" @click="startEditingMapping">Change</Button>
      </div>

      <!-- Edit view — only reached (and only fetches the catalog) once the
           admin clicks "Change" above. -->
      <template v-else>
        <select
          v-model="selectedAttrName"
          class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Not mapped — falls back to OS version only</option>
          <option v-for="a in store.smartAttributes" :key="a.id" :value="a.name">{{ a.name }}</option>
        </select>
        <p v-if="store.isLoadingSmartAttributes" class="text-xs text-gray-400">Loading Smart Attributes…</p>
        <p v-else-if="!store.smartAttributes.length" class="text-xs text-gray-400">No Smart Attributes found on this Applivery workspace yet.</p>
        <div class="flex items-center gap-2 pt-1">
          <Button :loading="isSavingMapping" :disabled="!mappingDirty" @click="saveMapping">Save</Button>
          <Button variant="ghost" :disabled="isSavingMapping" @click="cancelEditingMapping">Cancel</Button>
        </div>
      </template>
    </div>
  </div>
</template>
