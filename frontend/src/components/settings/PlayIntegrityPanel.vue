<script setup lang="ts">
// "Google Play Integrity API" tab (mobile telemetry roadmap Phase 3).
// Lets an admin provide their OWN GCP Cloud Project Number and offline-
// decryption key material per workspace, rather than a single hardcoded/
// env-var value — each workspace's Android app is its own distinct Play
// Console listing. See playIntegrity.ts (store) and playIntegrity.service.ts
// (backend) for the full end-to-end design.
//
// This form follows Play Console's ACTUAL "Manage and download my response
// encryption keys" flow exactly (confirmed against Play Console's own UI
// copy) — it is NOT a place to paste/upload the decryption key directly,
// because Play Console never hands that out directly for this option:
//
//   1. Admin generates an RSA-2048 key pair locally:
//        openssl genrsa -aes128 -out private.pem 2048
//        openssl rsa -in private.pem -pubout > public.pem
//   2. Admin uploads public.pem to Play Console (App integrity > Response
//      encryption > Manage and download my response encryption keys).
//   3. Play Console encrypts the real decryption/verification keys with
//      that RSA public key and lets the admin download the ciphertext
//      (commonly named e.g. api_keys.enc — always exactly 256 bytes, the
//      RSA-2048 block size).
//   4. Google's own documented recovery step is a local
//      `openssl pkeyutl -decrypt -inkey private.pem -pkeyopt
//      rsa_padding_mode:oaep -in api_keys.enc > api_keys.txt`, whose output
//      is DECRYPTION_KEY=.../VERIFICATION_KEY=... plaintext.
//
// Rather than asking the admin to run that command themselves and paste the
// result, this form uploads BOTH private.pem and the .enc file, and the
// backend (setPlayIntegrityConfig, playIntegrity.service.ts) performs that
// exact RSA-OAEP decryption server-side. The private key and its passphrase
// are used once for that decrypt call and are never stored.
import { Alert, Button, Input, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { usePlayIntegrityStore } from "../../stores/playIntegrity";

const store = usePlayIntegrityStore();

const cloudProjectNumber = ref("");
const privateKeyPem = ref("");
const privateKeyFileName = ref("");
const privateKeyPassphrase = ref("");
const encryptedResponseFileBase64 = ref("");
const encryptedResponseFileName = ref("");
const enabled = ref(true);
const saved = ref(false);
const fileError = ref<string | null>(null);

onMounted(async () => {
  await store.fetchStatus();
  if (store.status.cloudProjectNumber) cloudProjectNumber.value = store.status.cloudProjectNumber;
  enabled.value = store.status.configured ? store.status.enabled : true;
});

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function onPrivateKeyFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileError.value = null;
  try {
    // Genuinely PEM/ASCII-armored text — read and send as-is, no encoding
    // ambiguity to resolve (unlike the .enc file below, this one is never
    // raw binary).
    privateKeyPem.value = (await file.text()).trim();
    privateKeyFileName.value = file.name;
  } catch {
    fileError.value = `Couldn't read "${file.name}".`;
  }
}

async function onEncryptedResponseFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileError.value = null;
  try {
    // Unambiguously raw binary RSA-OAEP ciphertext (always exactly 256
    // bytes for an RSA-2048 key) — base64-encode the raw bytes directly as
    // a JSON transport convenience; the backend decrypts it as raw bytes.
    const buffer = await file.arrayBuffer();
    encryptedResponseFileBase64.value = bytesToBase64(new Uint8Array(buffer));
    encryptedResponseFileName.value = file.name;
  } catch {
    fileError.value = `Couldn't read "${file.name}".`;
  }
}

async function save() {
  saved.value = false;
  await store.setConfig({
    cloudProjectNumber: cloudProjectNumber.value.trim(),
    privateKeyPem: privateKeyPem.value,
    privateKeyPassphrase: privateKeyPassphrase.value || undefined,
    encryptedResponseFile: encryptedResponseFileBase64.value,
    enabled: enabled.value,
  });
  privateKeyPem.value = "";
  privateKeyFileName.value = "";
  privateKeyPassphrase.value = "";
  encryptedResponseFileBase64.value = "";
  encryptedResponseFileName.value = "";
  saved.value = true;
}

async function removeConfig() {
  if (!confirm("Remove the Google Play Integrity configuration for this workspace? Android devices stop reporting an integrity verdict, and related Compliance Policy conditions go permanently unmatched until reconfigured.")) return;
  await store.remove();
  cloudProjectNumber.value = "";
  privateKeyPem.value = "";
  privateKeyFileName.value = "";
  privateKeyPassphrase.value = "";
  encryptedResponseFileBase64.value = "";
  encryptedResponseFileName.value = "";
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
      configured under <strong>App integrity → Response encryption → Manage and download my response encryption
      keys</strong>, which works like this:
    </p>
    <ol class="text-xs text-gray-400 list-decimal list-inside space-y-1 pl-1">
      <li>Generate an RSA-2048 key pair locally: <code>openssl genrsa -aes128 -out private.pem 2048</code> then
        <code>openssl rsa -in private.pem -pubout &gt; public.pem</code>.</li>
      <li>Upload <code>public.pem</code> to Play Console and download the encrypted response file it gives you back
        (often named something like <code>api_keys.enc</code>).</li>
      <li>Upload <strong>both</strong> <code>private.pem</code> and that encrypted file below — this server decrypts
        it for you (the same operation as Play Console's own documented <code>openssl pkeyutl -decrypt</code>
        command) and extracts the actual keys automatically.</li>
    </ol>
    <p class="text-xs text-gray-400">
      Your private key and passphrase are used once for that decryption and are <strong>never stored</strong> — only
      the resulting decryption/verification keys are saved (encrypted at rest).
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
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">RSA private key (.pem)</label>
        <label
          class="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-brand-50 hover:border-brand-500 hover:text-brand-600 transition-colors"
        >
          {{ privateKeyFileName || "Choose private.pem" }}
          <input type="file" accept=".pem" class="hidden" @change="onPrivateKeyFileChosen" />
        </label>
      </div>

      <Input
        v-model="privateKeyPassphrase"
        type="password"
        label="Private key passphrase (only if you generated it with -aes128 or similar)"
        placeholder="Leave blank if your private key has no passphrase"
      />

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">Encrypted response file (.enc)</label>
        <label
          class="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-brand-50 hover:border-brand-500 hover:text-brand-600 transition-colors"
        >
          {{ encryptedResponseFileName || "Choose file downloaded from Play Console" }}
          <input type="file" class="hidden" @change="onEncryptedResponseFileChosen" />
        </label>
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pt-1">
        <input v-model="enabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" />
        Enabled — issue nonces and verify tokens for this workspace
      </label>

      <div class="flex items-center gap-2 pt-1">
        <Button
          :loading="store.isSaving"
          :disabled="!cloudProjectNumber.trim() || !privateKeyPem || !encryptedResponseFileBase64"
          @click="save"
        >
          Save
        </Button>
        <Button v-if="store.status.configured" variant="ghost" :loading="store.isSaving" @click="removeConfig">Remove</Button>
      </div>
      <p v-if="store.status.configured" class="text-xs text-gray-400">
        Re-upload the private key and encrypted response file any time you save, even if you're only changing the
        Cloud Project Number or the Enabled toggle — neither is kept from a previous save.
      </p>
    </div>
  </div>
</template>
