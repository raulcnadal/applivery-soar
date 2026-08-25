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

function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Decodes `text` as either standard base64 (`+`/`/`, optional `=` padding)
 * or base64url (`-`/`_`, padding usually omitted — the encoding Google's
 * own ecosystem, including the Play Integrity token itself, tends to use).
 * Returns null rather than throwing when `text` isn't valid under this
 * variant at all, so callers can try multiple variants and see which one
 * (if any) actually decodes.
 */
function decodeBase64Variant(text: string, urlSafe: boolean): Uint8Array | null {
  let normalized = text.replace(/\s+/g, "");
  if (!normalized) return null;
  if (urlSafe) normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) normalized += "=";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Strips a PEM armor block ("-----BEGIN X-----\n...\n-----END X-----") down
 * to just its base64 body, with internal line breaks removed — PEM's own
 * dashes and header/footer text aren't valid base64 characters, so without
 * this a PEM-formatted file would fail every base64 decode attempt and
 * silently fall through to the raw-bytes path, which is wrong (the PEM
 * armor text itself isn't the key material). Returns null when no PEM
 * markers are present at all, so callers can tell "not PEM" apart from "PEM
 * with an empty body".
 */
function extractPemBody(text: string): string | null {
  const match = text.match(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/);
  if (!match) return null;
  return match[1].replace(/\s+/g, "");
}

/**
 * Google mixes standard base64, unpadded base64url, and (via gcloud/Cloud
 * KMS-adjacent tooling) PEM-armored output fairly freely across its own
 * products, and admins sometimes save a copy-pasted key into a file with an
 * editor that prepends a UTF-8 BOM. An earlier version of this function
 * guessed "does this look like base64" with a single fixed-charset check —
 * that misdetected an unpadded base64url-encoded (or PEM-armored) key as
 * raw binary and re-encoded it on top of itself, silently sending the
 * backend something that decoded to a wrong, inflated byte count (reported
 * as e.g. "got 256" instead of the correct 32).
 *
 * Instead of guessing, try every plausible decoding — PEM body (both base64
 * variants), whole-file-text (both base64 variants), and the file's raw
 * bytes as-is — and prefer whichever one actually produces the caller's
 * known-correct byte length (`expectedByteLength` — 32 for an AES-256
 * decryption key). When none of them match, fail loudly HERE with the
 * actual candidate lengths rather than silently sending a guess for the
 * backend to reject less specifically. When the caller has no single fixed
 * length to check against (the verification key's DER encoding varies
 * slightly by curve/encoding), falls back to "prefer a PEM body if present,
 * then standard base64, then base64url, then raw bytes".
 */
async function fileToBase64Key(file: File, expectedByteLength?: number): Promise<string> {
  const buffer = await file.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);
  const asText = stripBom(new TextDecoder("utf-8", { fatal: false }).decode(rawBytes)).trim();

  const pemBody = extractPemBody(asText);
  const pemStandard = pemBody ? decodeBase64Variant(pemBody, false) : null;
  const pemUrlSafe = pemBody ? decodeBase64Variant(pemBody, true) : null;
  const standard = decodeBase64Variant(asText, false);
  const urlSafe = decodeBase64Variant(asText, true);

  // PEM-derived candidates take priority when present — if the file has PEM
  // armor at all, the armor-wrapped body is virtually certainly the
  // intended key material, not the raw file bytes (which would just be the
  // armor text itself, ASCII-encoded).
  const orderedCandidates = [pemStandard, pemUrlSafe, standard, urlSafe, rawBytes].filter(
    (c): c is Uint8Array => c !== null,
  );

  if (expectedByteLength) {
    const exact = orderedCandidates.find((c) => c.length === expectedByteLength);
    if (exact) return bytesToBase64(exact);
    const gotLengths = [...new Set(orderedCandidates.map((c) => c.length))].join(" or ");
    throw new Error(
      `This file doesn't decode to ${expectedByteLength} bytes under any recognized format (got ${gotLengths} byte(s) depending on interpretation) — re-download it from Play Console's App integrity > Response encryption section.`,
    );
  }

  return bytesToBase64(orderedCandidates[0] ?? rawBytes);
}

async function onDecryptionKeyFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileError.value = null;
  try {
    // AES-256 key wrap (A256KW) requires exactly a 256-bit (32-byte) key --
    // a hard, documented constraint, unlike the verification key below.
    decryptionKeyBase64.value = await fileToBase64Key(file, 32);
    decryptionKeyFileName.value = file.name;
  } catch (error: any) {
    fileError.value = error?.message || `Couldn't read "${file.name}" — try re-downloading it from Play Console.`;
  }
}

async function onVerificationKeyFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileError.value = null;
  try {
    verificationKeyBase64.value = await fileToBase64Key(file);
    verificationKeyFileName.value = file.name;
  } catch (error: any) {
    fileError.value = error?.message || `Couldn't read "${file.name}" — try re-downloading it from Play Console.`;
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
