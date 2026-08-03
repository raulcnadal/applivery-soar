<script setup lang="ts">
// "Workspace Automation" tab (docs/settings.md#workspace-automation).
import { Alert, Button, StatusPill } from "@applivery/bluesky-vue";
import { onMounted } from "vue";
import { useWorkspaceAutomationStore } from "../../stores/workspaceAutomation";
import { useAuthStore } from "../../stores/auth";

const store = useWorkspaceAutomationStore();
const auth = useAuthStore();

onMounted(async () => {
  await store.fetchStatus();
});

async function useThisSession() {
  if (!auth.apiToken || !auth.refreshToken) return;
  await store.useCurrentSession({
    apiToken: auth.apiToken,
    refreshToken: auth.refreshToken,
    apiTokenExpireAt: auth.apiTokenExpireAt,
    refreshTokenExpireAt: auth.refreshTokenExpireAt,
  });
}

async function removeCredential() {
  if (!confirm("Remove the automation credential for this workspace? Background jobs (compliance evaluation, scheduled reports, ticket sync, etc.) stop running for this workspace until reconfigured.")) return;
  await store.remove();
}
</script>

<template>
  <div class="space-y-4 max-w-2xl">
    <p class="text-xs text-gray-400">
      Background jobs run with no human signed in, but Applivery API tokens are per-session and expire — this stores a
      standing credential per workspace so unattended jobs (compliance evaluator, ticket sync, scheduled reports, and
      others) can keep calling Applivery's API. Any signed-in admin can set this to their own session.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-4 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">Status:</span>
        <StatusPill :label="store.status.configured ? 'Configured' : 'Not configured'" :color="store.status.configured ? 'green' : 'gray'" />
      </div>
      <p v-if="store.status.configured" class="text-sm text-gray-500 dark:text-gray-400">
        Set by {{ store.status.configuredBy || "unknown" }} on {{ store.status.configuredAt ? new Date(store.status.configuredAt).toLocaleString() : "—" }}.
        Last refreshed: {{ store.status.lastRefreshedAt ? new Date(store.status.lastRefreshedAt).toLocaleString() : "never" }}.
      </p>
      <div class="flex items-center gap-2 pt-1">
        <Button :loading="store.isSaving" @click="useThisSession">Use this session for automation</Button>
        <Button v-if="store.status.configured" variant="ghost" :loading="store.isSaving" @click="removeCredential">Remove</Button>
      </div>
    </div>
  </div>
</template>
