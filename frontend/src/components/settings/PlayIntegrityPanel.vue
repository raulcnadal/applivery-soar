<script setup lang="ts">
// "Google Play Integrity API" tab (mobile telemetry roadmap Phase 3).
// Lets an admin provide their OWN GCP Cloud Project Number and offline-
// decryption key pair per workspace, rather than a single hardcoded/env-var
// value — each workspace's Android app is its own distinct Play Console
// listing. See playIntegrity.ts (store) and playIntegrity.service.ts
// (backend) for the full end-to-end design.
//
// Keys are provided as FILE UPLOADS, not pasted text — Play Console's own
// "Response encryption" download gives the decryption key as a file
// (commonly a `.enc` extension) and the verification key similarly, and
// admins copy-pasting binary/encoded file contents by hand is error-prone
// (trailing newlines, partial selections, invisible whitespace). The
// backend's contract (POST /api/settings/play-integrity) is unchanged —
// it still expects `decryptionKey`/`verificationKey` as base64 strings — so
// this component does the file-to-base64 conversion client-side, in
// fileToBase64Key below.
import { Alert, Button, Input, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { usePlayIntegrityStore } from "../../stores/playIntegrity";

const store = usePlayIntegrityStore();

const cloudProjectNumber = ref("");
const decryptionKeyBase64 = ref("");
const verificationKeyBase64 = ref("");
const decryptionKeyFileName = ref("");
const verificationKeyFileName = ref("");
const enabled = ref(true);
const saved = ref(false);
const fileError = ref<string | null>(null);

onMounted(async () => {
  await store.fetchStatus();
  if (store.status.cloudProjectNumber) cloudProjectNumber.value = store.status.cloudProjectNumber;
  enabled.value = store.status.configured ? store.status.enabled : true;
});

function looksLikeBase64(text: string): boolean {
  if (!text) return false;
  const stripped = text.replace(/\s+/g, "");
  return stripped.length > 0 && stripped.length % 4 === 0 && /^[A-Za-z0-9+/]+=*$/.test(stripped);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Google hands out these keys two different ways depending on how the file
 * was generated/downloaded: sometimes the file's content IS already a
 * base64 string (saved to disk with a `.enc`/custom extension), sometimes
 * the file is the raw key bytes themselves. Handle both without asking the
 * admin to know or care which: if the file's text content decodes cleanly
 * as base64, use that text verbatim (it's already what the backend wants);
 * otherwise the file's raw bytes ARE the key material, so base64-encode
 * them ourselves.
 */
async function fileToBase64Key(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const asText = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  if (looksLikeBase64(asText)) {
    try {
      atob(asText.replace(/\s+/g, ""));
      return asText.replace(/\s+/g, "");
    } catch {
      // Not actually valid base64 despite looking like it — fall through.
    }
  }
  return bytesToBase64(bytes);
}

async function onDecryptionKeyFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileError.value = null;
  try {
    decryptionKeyBase64.value = await fileToBase64Key(file);
    decryptionKeyFileName.value = file.name;
  } catch {
    fileError.value = `Couldn't read "${file.name}" — try re-downloading it from Play Console.`;
  }
}

async function onVerificationKeyFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileError.value = null;
  try {
    verificationKeyBase64.value = await fileToBase64Key(file);
    verificationKeyFileName.value = file.name;
  } catch {
    fileError.value = `Couldn't read "${file.name}" — try re-downloading it from Play Console.`;
  }
}

async function save() {
  saved.value = false;
  await store.setConfig({
    cloudProjectNumber: cloudProjectNumber.value.trim(),
    decryptionKey: decryptionKeyBase64.value,
    verificationKey: verificationKeyBase64.value,
    enabled: enabled.value,
  });
  decryptionKeyBase64.value = "";
  verificationKeyBase64.value = "";
  decryptionKeyFileName.value = "";
  verificationKeyFileName.value = "";
  saved.value = true;
}

async function removeConfig() {
  if (!confirm("Remove the Google Play Integrity configuration for this workspace? Android devices stop reporting an integrity verdict, and related Compliance Policy conditions go permanently unmatched until reconfigured.")) return;
  await store.remove();
  cloudProjectNumber.value = "";
  decryptionKeyBase64.value = "";
  verificationKeyBase64.value = "";
  decryptionKeyFileName.value = "";
  verificationKeyFileName.value = "";
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
      so provide your own <strong>Cloud Project Number</strong> and upload the key files downloaded from
      <strong>Play Console → App integrity → Response encryption</strong> (the decryption key is typically a
      <code>.enc</code> file; the verification key file has no fixed extension) — both are read and converted
      locally in your browser before being sent.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="fileError" type="danger">{{ fileError }}</Alert>
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

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">Decryption key file</label>
        <label
          class="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-brand-50 hover:border-brand-500 hover:text-brand-600 transition-colors"
        >
          {{ decryptionKeyFileName || "Choose file (.enc or similar)" }}
          <input type="file" class="hidden" @change="onDecryptionKeyFileChosen" />
        </label>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">Verification key file</label>
        <label
          class="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-brand-50 hover:border-brand-500 hover:text-brand-600 transition-colors"
        >
          {{ verificationKeyFileName || "Choose file" }}
          <input type="file" class="hidden" @change="onVerificationKeyFileChosen" />
        </label>
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pt-1">
        <input v-model="enabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" />
        Enabled — issue nonces and verify tokens for this workspace
      </label>

      <div class="flex items-center gap-2 pt-1">
        <Button
          :loading="store.isSaving"
          :disabled="!cloudProjectNumber.trim() || !decryptionKeyBase64 || !verificationKeyBase64"
          @click="save"
        >
          Save
        </Button>
        <Button v-if="store.status.configured" variant="ghost" :loading="store.isSaving" @click="removeConfig">Remove</Button>
      </div>
      <p v-if="store.status.configured" class="text-xs text-gray-400">
        The key files are write-only and never sent back to the browser — re-upload both any time you save, even if
        you're only changing the Cloud Project Number or the Enabled toggle.
      </p>
    </div>
  </div>
</template>
