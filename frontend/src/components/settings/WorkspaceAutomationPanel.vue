<script setup lang="ts">
// "Workspace Automation" tab (docs/settings.md#workspace-automation).
import { Alert, Button, Input, StatusPill } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { useWorkspaceAutomationStore } from "../../stores/workspaceAutomation";

const store = useWorkspaceAutomationStore();
const tokenInput = ref("");
const selectedAttrName = ref<string>("");
const isSavingMapping = ref(false);
const mappingSaved = ref(false);

onMounted(async () => {
  // Promise.allSettled, not Promise.all — each of these three already
  // catches its own errors internally (see workspaceAutomation.ts), but this
  // guarantees the line below always runs even if that ever regresses. A
  // previous version used Promise.all with fetchSmartAttributes()
  // (a documented-flaky Applivery API call) missing its own try/catch: one
  // transient failure there rejected the whole Promise.all, which skipped
  // this assignment entirely — leaving the dropdown on "Not mapped" even
  // though the mapping was correctly saved and successfully fetched by the
  // OTHER call in the same batch. Looked exactly like a save that silently
  // reverted; the save/read round-trip was fine the whole time.
  await Promise.allSettled([store.fetchStatus(), store.fetchOsPatchLevelMapping(), store.fetchSmartAttributes()]);
  selectedAttrName.value = store.osPatchLevelSmartAttributeName ?? "";
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

async function saveMapping() {
  isSavingMapping.value = true;
  mappingSaved.value = false;
  try {
    await store.setOsPatchLevelMapping(selectedAttrName.value || null);
    mappingSaved.value = true;
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
      <select
        v-model="selectedAttrName"
        class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-brand-500"
      >
        <option value="">Not mapped — falls back to OS version only</option>
        <option v-for="a in store.smartAttributes" :key="a.id" :value="a.name">{{ a.name }}</option>
      </select>
      <p v-if="!store.smartAttributes.length" class="text-xs text-gray-400">No Smart Attributes found on this Applivery workspace yet.</p>
      <div class="flex items-center gap-2 pt-1">
        <Button :loading="isSavingMapping" :disabled="!mappingDirty" @click="saveMapping">Save</Button>
      </div>
    </div>
  </div>
</template>
