<script setup lang="ts">
// "Google Play Integrity API" tab (mobile telemetry roadmap Phase 3).
// Lets an admin provide their OWN GCP Cloud Project Number and offline-
// decryption key pair per workspace, rather than a single hardcoded/env-var
// value — each workspace's Android app is its own distinct Play Console
// listing. See playIntegrity.ts (store) and playIntegrity.service.ts
// (backend) for the full end-to-end design.
import { Alert, Button, Input, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { usePlayIntegrityStore } from "../../stores/playIntegrity";

const store = usePlayIntegrityStore();

const cloudProjectNumber = ref("");
const decryptionKey = ref("");
const verificationKey = ref("");
const enabled = ref(true);
const saved = ref(false);

onMounted(async () => {
  await store.fetchStatus();
  if (store.status.cloudProjectNumber) cloudProjectNumber.value = store.status.cloudProjectNumber;
  enabled.value = store.status.configured ? store.status.enabled : true;
});

async function save() {
  saved.value = false;
  await store.setConfig({
    cloudProjectNumber: cloudProjectNumber.value.trim(),
    decryptionKey: decryptionKey.value.trim(),
    verificationKey: verificationKey.value.trim(),
    enabled: enabled.value,
  });
  decryptionKey.value = "";
  verificationKey.value = "";
  saved.value = true;
}

async function removeConfig() {
  if (!confirm("Remove the Google Play Integrity configuration for this workspace? Android devices stop reporting an integrity verdict, and related Compliance Policy conditions go permanently unmatched until reconfigured.")) return;
  await store.remove();
  cloudProjectNumber.value = "";
  decryptionKey.value = "";
  verificationKey.value = "";
  saved.value = false;
}
</script>

<template>
  <div class="space-y-4 max-w-2xl">
    <p class="text-xs text-gray-400">
      The SOAR Mobile Agent's Android build can request a
      <strong>Google Play Integrity</strong> Classic API token to confirm the app hasn't been tampered with and the
      device isn't rooted or otherwise compromised — decrypted and verified entirely on this server (offline
      decryption), never trusting anything the device itself claims. Each workspace has its own Play Console listing,
      so provide your own <strong>Cloud Project Number</strong> and the key pair downloaded from
      <strong>Play Console → App integrity → Response encryption</strong>: a base64 AES-256 decryption key and a
      base64 DER-encoded EC public verification key.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="saved && !store.error" type="success">Saved.</Alert>

    <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-4 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">Status:</span>
        <StatusPill
          :label="store.status.configured ? (store.status.enabled ? 'Configured' : 'Configured (disabled)') : 'Not configured'"
          :color="store.status.configured && store.status.enabled ? 'green' : store.status.configured ? 'gray' : 'gray'"
        />
      </div>
      <p v-if="store.status.configured" class="text-sm text-gray-500 dark:text-gray-400">
        Cloud Project Number {{ store.status.cloudProjectNumber }}. Set by {{ store.status.configuredBy || "unknown" }}
        on {{ store.status.configuredAt ? new Date(store.status.configuredAt).toLocaleString() : "—" }}.
      </p>

      <Input v-model="cloudProjectNumber" label="Cloud Project Number" placeholder="e.g. 55887091184" />
      <Input v-model="decryptionKey" type="password" label="Decryption key (base64)" placeholder="Paste the base64 AES-256 decryption key" />
      <Input v-model="verificationKey" type="password" label="Verification key (base64)" placeholder="Paste the base64 DER-encoded EC public key" />
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pt-1">
        <input v-model="enabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" />
        Enabled — issue nonces and verify tokens for this workspace
      </label>

      <div class="flex items-center gap-2 pt-1">
        <Button
          :loading="store.isSaving"
          :disabled="!cloudProjectNumber.trim() || !decryptionKey.trim() || !verificationKey.trim()"
          @click="save"
        >
          Save
        </Button>
        <Button v-if="store.status.configured" variant="ghost" :loading="store.isSaving" @click="removeConfig">Remove</Button>
      </div>
      <p v-if="store.status.configured" class="text-xs text-gray-400">
        The key fields are write-only and never sent back to the browser — re-paste both keys any time you save,
        even if you're only changing the Cloud Project Number or the Enabled toggle.
      </p>
    </div>
  </div>
</template>
