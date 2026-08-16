<script setup lang="ts">
// "Workspace Automation" tab (docs/settings.md#workspace-automation).
import { Alert, Button, Input, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { useWorkspaceAutomationStore } from "../../stores/workspaceAutomation";

const store = useWorkspaceAutomationStore();
const tokenInput = ref("");

onMounted(async () => {
  await store.fetchStatus();
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
  </div>
</template>
