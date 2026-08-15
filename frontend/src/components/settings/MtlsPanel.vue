<script setup lang="ts">
// "mTLS Agent Authentication" tab — disclosed new feature, no main.py/App.jsx
// equivalent. Admin surface for backend/docs/mtls-agent-auth-roadmap.md's
// full Phase A-C build: the workspace's Certificate Authority (generate or
// upload), one-time bootstrap tokens that let a device enroll for its own
// client certificate, the resulting fleet of issued device certificates, and
// the Phase C cutover switch that makes mTLS mandatory instead of optional
// on the 6 device-caller routes (deviceData.controller.ts). Every mutating
// action here requires the canManageMtlsCA risky-action flag
// (rbac.middleware.ts / RoleDialog.vue) — replacing the CA or flipping
// enforcement are exactly the class of consequential, hard-to-reverse action
// that flag category exists for.
import { computed, onMounted, reactive, ref } from "vue";
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useAuthStore } from "../../stores/auth";
import { useMtlsStore, type SelfServiceMode } from "../../stores/mtls";
import { copyToClipboard } from "../../lib/clipboard";

const emit = defineEmits<{ goToTab: [id: string] }>();

const store = useMtlsStore();
const auth = useAuthStore();
const canEdit = () => auth.hasRiskyAction("canManageMtlsCA");

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── CA ──

const showUploadForm = ref(false);
const uploadForm = reactive({ certPem: "", privateKeyPem: "" });
const uploadBusy = ref(false);
const leafValidityInput = ref(90);
const leafValidityDirty = ref(false);

const caStatusColor = computed(() => (store.caStatus?.configured ? "bg-emerald-500" : "bg-amber-500"));

async function doGenerateCa() {
  const replace = Boolean(store.caStatus?.configured);
  if (replace && !confirm("Replace the existing Certificate Authority? Every currently-issued device certificate's chain of trust becomes invalid immediately — devices will need to re-register with a fresh bootstrap token.")) {
    return;
  }
  try {
    await store.generateCa(replace);
  } catch {
    // Surfaced via store.caError in the template.
  }
}

async function doUploadCa() {
  const replace = Boolean(store.caStatus?.configured);
  if (replace && !confirm("Replace the existing Certificate Authority with the uploaded pair? Every currently-issued device certificate's chain of trust becomes invalid immediately.")) {
    return;
  }
  uploadBusy.value = true;
  try {
    await store.uploadCa(uploadForm.certPem, uploadForm.privateKeyPem, replace);
    uploadForm.certPem = "";
    uploadForm.privateKeyPem = "";
    showUploadForm.value = false;
  } catch {
    // Surfaced via store.caError in the template.
  } finally {
    uploadBusy.value = false;
  }
}

async function doSaveLeafValidity() {
  try {
    await store.setLeafValidityDays(Number(leafValidityInput.value));
    leafValidityDirty.value = false;
  } catch {
    // Surfaced via store.caError in the template.
  }
}

// ── Bootstrap tokens ──

// "fleet" (default) reads candidate serial numbers straight from Applivery
// UEM's own device list — requested specifically so the admin never has to
// type or paste serial numbers Applivery already knows. "single"/"bulk"
// stay available as a manual fallback (a device not yet visible to
// Applivery, or a workspace with no Automation Credential configured yet).
const mintMode = ref<"fleet" | "single" | "bulk">("fleet");
const mintSerial = ref("");
const mintSerialsBulk = ref("");
const mintExpiresInDays = ref(7);

async function doMint() {
  if (mintMode.value === "single") {
    if (!mintSerial.value.trim()) return;
    await store.mintBootstrapToken(mintSerial.value.trim(), mintExpiresInDays.value);
    mintSerial.value = "";
  } else if (mintMode.value === "bulk") {
    const serials = mintSerialsBulk.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (serials.length === 0) return;
    await store.mintBootstrapTokensBulk(serials, mintExpiresInDays.value);
    mintSerialsBulk.value = "";
  } else {
    const serials = Array.from(fleetSelected.value);
    if (serials.length === 0) return;
    await store.mintBootstrapTokensBulk(serials, mintExpiresInDays.value);
    fleetSelected.value.clear();
  }
}

// ── Fleet picker (mintMode === "fleet") ──

const fleetSearch = ref("");
const fleetPlatformFilter = ref("windows"); // only the Windows Agent exists so far (roadmap: macOS fast-follow)
const fleetHideEnrolled = ref(true);
const fleetSelected = ref<Set<string>>(new Set());

const fleetPlatforms = computed(() => {
  const set = new Set(store.enrollmentCandidates.map((c) => c.platform));
  return Array.from(set).sort();
});

const ENROLLED_STATUSES = new Set(["active", "expiring-soon"]);
const filteredFleet = computed(() => {
  const q = fleetSearch.value.trim().toLowerCase();
  return store.enrollmentCandidates.filter((c) => {
    if (fleetPlatformFilter.value !== "all" && c.platform !== fleetPlatformFilter.value) return false;
    if (fleetHideEnrolled.value && ENROLLED_STATUSES.has(c.mtlsStatus)) return false;
    if (q && !c.serialNumber.toLowerCase().includes(q) && !c.displayName.toLowerCase().includes(q)) return false;
    return true;
  });
});

function toggleFleetSelect(serialNumber: string) {
  if (fleetSelected.value.has(serialNumber)) fleetSelected.value.delete(serialNumber);
  else fleetSelected.value.add(serialNumber);
  // Set mutations aren't tracked by Vue's reactivity on their own — reassign to trigger re-render.
  fleetSelected.value = new Set(fleetSelected.value);
}
function selectAllVisible() {
  fleetSelected.value = new Set([...fleetSelected.value, ...filteredFleet.value.map((c) => c.serialNumber)]);
}
function clearFleetSelection() {
  fleetSelected.value = new Set();
}

const FLEET_STATUS_COLOR: Record<string, string> = {
  none: "bg-gray-300 dark:bg-gray-600",
  pending: "bg-amber-500",
  active: "bg-emerald-500",
  "expiring-soon": "bg-amber-500",
  expired: "bg-gray-400",
  revoked: "bg-red-500",
  superseded: "bg-gray-400",
};
const FLEET_STATUS_LABEL: Record<string, string> = {
  none: "not enrolled",
  pending: "token pending",
  active: "enrolled",
  "expiring-soon": "enrolled (expiring soon)",
  expired: "cert expired",
  revoked: "cert revoked",
  superseded: "cert superseded",
};

// navigator.clipboard.writeText is only available in a "secure context"
// (https:, or http://localhost) — it silently returns undefined/throws
// everywhere else, e.g. a dashboard reached over plain http://<lan-ip>:8080
// (this app's own docker-compose.yml exposes soar-frontend that way with no
// TLS by default), which is exactly why the button did nothing. Falls back
// to the older execCommand("copy") path (no secure-context requirement,
// still supported everywhere despite being deprecated) and surfaces a clear
// message if even that fails, instead of failing silently.
const copiedTokenId = ref<string | null>(null);
async function copyToken(token: string, id: string) {
  const ok = await copyToClipboard(token);
  if (ok) {
    copiedTokenId.value = id;
    setTimeout(() => {
      if (copiedTokenId.value === id) copiedTokenId.value = null;
    }, 2000);
  } else {
    alert(
      "Couldn't copy automatically — this usually happens when the dashboard is loaded over plain HTTP instead of HTTPS, which browsers block clipboard access on. Select the token text above and copy it manually (Ctrl/Cmd+C).",
    );
  }
}

async function doRevokeToken(id: string, serialNumber: string) {
  if (!confirm(`Revoke the pending bootstrap token for "${serialNumber}"? It will no longer be able to register.`)) return;
  await store.revokeBootstrapToken(id);
}

const TOKEN_STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500",
  used: "bg-emerald-500",
  expired: "bg-gray-400",
};

// ── Self-service enrollment (Phase E addendum) ──
// The alternative to per-device bootstrap tokens for fleets with no way to
// deliver a unique secret to each device individually: one shared secret
// deployed via a single Managed Configuration push to the whole fleet, plus
// a live check against Applivery's own device list. See
// mtlsEnrollment.service.ts's module doc for the full trust-model trade-off
// — this UI surfaces the same caveats rather than hiding them.

const showEnrollmentSnippet = ref(false);
const MODE_LABEL: Record<SelfServiceMode, string> = { disabled: "Disabled", approval: "Approval required", silent: "Silent (zero-touch)" };
const MODE_DESCRIPTION: Record<SelfServiceMode, string> = {
  disabled: "The one-time-token flow above is the only way for a device to enroll. Nothing changes for a workspace that hasn't opted into this.",
  approval: "A device presenting the shared secret + a serial number Applivery currently recognizes lands in the queue below — nothing is issued until you approve it.",
  silent: "A device presenting the shared secret + a currently-enrolled Applivery serial number gets a certificate immediately, no approval click. True zero-touch — see the warning below before enabling.",
};

async function doRotateEnrollmentSecret() {
  const replacing = Boolean(store.enrollmentSecretStatus?.configured);
  if (replacing && !confirm("Rotate the enrollment secret? Any device that hasn't picked up the new value from Managed Configuration yet will fail to enroll until it does.")) return;
  await store.rotateEnrollmentSecret();
}
async function doClearEnrollmentSecret() {
  if (!confirm("Remove the enrollment secret? Self-service enrollment mode resets to Disabled and no device can self-service enroll until a new secret is generated.")) return;
  await store.clearEnrollmentSecret();
}
function copyEnrollmentSecret() {
  if (store.enrollmentSecretStatus?.secret) copyToClipboard(store.enrollmentSecretStatus.secret);
}

async function doSetSelfServiceMode(mode: SelfServiceMode) {
  if (mode === store.selfServiceMode) return;
  if (mode === "silent") {
    if (
      !confirm(
        "Enable SILENT self-service enrollment? Any request with the right secret and a serial number Applivery currently recognizes as enrolled gets a certificate immediately, with no admin review. Anyone who obtains the shared secret can claim any not-yet-enrolled device the moment they know its serial number. An already-enrolled device can never be silently re-claimed, but a not-yet-enrolled one can be claimed by whoever gets there first. Proceed?",
      )
    )
      return;
  } else if (mode === "approval") {
    if (store.selfServiceMode === "silent" && !confirm("Switch to approval-required mode? New requests will wait in a queue for your review instead of being issued immediately.")) return;
  }
  try {
    await store.setSelfServiceMode(mode);
    if (mode === "approval") await store.fetchEnrollmentRequests();
  } catch {
    // Surfaced via store.selfServiceModeError in the template.
  }
}

const windowsEnrollmentSnippet = computed(() => {
  const secret = store.enrollmentSecretStatus?.secret ?? "";
  return `# Applivery SOAR Agent — Self-Service mTLS Enrollment (PowerShell)
# Deploy: Applivery Dashboard > Resources > Scripts > Create Script (language: PowerShell),
# paste this, then assign it to the Policy covering this fleet — Scope: Machine, Execution: Once.
$ErrorActionPreference = "Stop"
$regPath = "HKLM:\\SOFTWARE\\Policies\\Applivery\\SOAR"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "BaseURL" -Value "${window.location.origin}" -Type String
Set-ItemProperty -Path $regPath -Name "WorkspaceSlug" -Value "${auth.orgSlug}" -Type String
Set-ItemProperty -Path $regPath -Name "EnrollmentSecret" -Value "${secret}" -Type String
Write-Host "Applivery SOAR Agent self-service enrollment configuration applied."
`;
});
function downloadEnrollmentSnippet() {
  const blob = new Blob([windowsEnrollmentSnippet.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "applivery-soar-agent-self-service-enrollment.ps1";
  a.click();
  URL.revokeObjectURL(url);
}
function copyEnrollmentSnippet() {
  copyToClipboard(windowsEnrollmentSnippet.value);
}

async function doApproveRequest(id: string, serialNumber: string) {
  if (!confirm(`Approve enrollment for "${serialNumber}"? A client certificate will be issued immediately.`)) return;
  try {
    await store.approveEnrollmentRequest(id);
  } catch {
    // Surfaced via store.enrollmentRequestsError in the template.
  }
}
async function doRejectRequest(id: string, serialNumber: string) {
  const reason = prompt(`Reject enrollment for "${serialNumber}"? Enter a reason:`);
  if (!reason) return;
  await store.rejectEnrollmentRequest(id, reason);
}

// ── Certificates ──

const CERT_STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500",
  "expiring-soon": "bg-amber-500",
  expired: "bg-gray-400",
  revoked: "bg-red-500",
  superseded: "bg-gray-400",
};

async function doRevokeCert(id: string, serialNumber: string) {
  const reason = prompt(`Revoke the device certificate for "${serialNumber}"? Enter a reason (this device goes dark until it re-registers):`);
  if (!reason) return;
  await store.revokeCertificate(id, reason);
}

// ── Enforcement ──

async function doToggleEnforcement() {
  const enabling = !store.enforcementEnabled;
  const msg = enabling
    ? "Enable mTLS enforcement for this workspace? Every device on the 6 report/status routes must present a valid client certificate from this point forward — any device that hasn't registered yet goes dark until it does."
    : "Disable mTLS enforcement? The legacy X-Device-Report-Secret becomes acceptable again on the 6 device-caller routes.";
  if (!confirm(msg)) return;
  try {
    await store.setEnforcement(enabling);
  } catch {
    // Surfaced via store.enforcementError in the template.
  }
}

onMounted(async () => {
  await store.fetchCaStatus();
  await store.fetchBootstrapTokens();
  await store.fetchEnrollmentCandidates();
  await store.fetchEnrollmentSecretStatus();
  await store.fetchSelfServiceMode();
  if (store.selfServiceMode === "approval") await store.fetchEnrollmentRequests();
  await store.fetchCertificates();
  await store.fetchEnforcement();
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">mTLS Agent Authentication</h3>
      <p class="text-[11px] leading-relaxed mb-3 text-gray-500 dark:text-gray-400">
        Replaces the shared X-Device-Report-Secret with per-device client certificates: each device generates its own
        keypair, enrolls once using a one-time bootstrap token below, and from then on authenticates with a short-lived
        cert that renews itself automatically. The reverse proxy in front of this backend (nginx/NPM, Traefik, Caddy,
        HAProxy — any TLS-terminating proxy) must be configured to request and forward the client cert per
        backend/docs/mtls-agent-auth-roadmap.md §5.5. Fully additive until you flip enforcement on below.
      </p>
      <Alert v-if="!canEdit()" type="info">Your role doesn't have the canManageMtlsCA permission — every control below is read-only.</Alert>
      <Alert type="info">
        Ready to push this to the fleet? <button type="button" class="underline font-semibold" @click="emit('goToTab', 'agent-deployment')">Agent Deployment</button>
        combines the CA/secret status here with the reporting toggles into one downloadable Managed Configuration bundle.
      </Alert>
    </div>

    <!-- Certificate Authority -->
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Certificate Authority</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <Alert v-if="store.caError" type="danger">{{ store.caError }}</Alert>
        <p v-if="store.caLoading" class="text-xs text-gray-500 dark:text-gray-400">Checking status…</p>
        <template v-else>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full shrink-0" :class="caStatusColor" />
            <span class="text-xs font-semibold text-gray-900 dark:text-white">
              <template v-if="store.caStatus?.configured">CA configured ({{ store.caStatus.source }})</template>
              <template v-else>No CA configured yet for this workspace</template>
            </span>
          </div>

          <div v-if="store.caStatus?.configured" class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span>Key algorithm: <span class="font-mono text-gray-900 dark:text-white">{{ store.caStatus.keyAlgorithm }}</span></span>
            <span>Leaf validity: <span class="font-mono text-gray-900 dark:text-white">{{ store.caStatus.leafValidityDays }} days</span></span>
            <span>Valid from: {{ fmt(store.caStatus.notBefore) }}</span>
            <span>Valid until: {{ fmt(store.caStatus.notAfter) }}</span>
            <span v-if="store.caStatus.uploadedBy">Uploaded by: {{ store.caStatus.uploadedBy }}</span>
            <span>Updated: {{ fmt(store.caStatus.updatedAt) }}</span>
          </div>

          <div v-if="store.caStatus?.configured" class="pt-1">
            <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Leaf certificate validity (days, minimum 47)</label>
            <div class="flex items-center gap-2">
              <Input
                v-model.number="leafValidityInput"
                type="number"
                min="47"
                :disabled="!canEdit()"
                class="w-28"
                @update:model-value="leafValidityDirty = true"
              />
              <Button size="sm" variant="ghost" :disabled="!canEdit() || !leafValidityDirty" :loading="store.caBusy" @click="doSaveLeafValidity">Save</Button>
            </div>
            <p class="text-[10px] mt-1 leading-relaxed text-gray-400">
              Devices renew automatically once a third of this window remains — a shorter window means more frequent
              renewal traffic. 90 days (60-day safety margin) is the default; 47 is the floor, chosen to stay ahead of
              the CA/Browser Forum's trend toward shorter public TLS lifetimes.
            </p>
          </div>

          <div class="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" :disabled="!canEdit()" @click="showUploadForm = !showUploadForm">
              {{ showUploadForm ? "Cancel upload" : "Upload external CA" }}
            </Button>
            <Button size="sm" :disabled="!canEdit()" :loading="store.caBusy" @click="doGenerateCa">
              {{ store.caStatus?.configured ? "Regenerate CA" : "Generate CA" }}
            </Button>
          </div>

          <div v-if="showUploadForm" class="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
            <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
              Paste a PEM-encoded CA certificate and its matching private key. The private key is encrypted at rest and
              never returned by any endpoint after this.
            </p>
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">CA certificate (PEM)</label>
              <textarea
                v-model="uploadForm.certPem"
                rows="4"
                :disabled="!canEdit()"
                class="w-full px-2 py-1.5 rounded-lg text-[10px] font-mono outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
                placeholder="-----BEGIN CERTIFICATE-----"
              />
            </div>
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">CA private key (PEM)</label>
              <textarea
                v-model="uploadForm.privateKeyPem"
                rows="4"
                :disabled="!canEdit()"
                class="w-full px-2 py-1.5 rounded-lg text-[10px] font-mono outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
                placeholder="-----BEGIN PRIVATE KEY-----"
              />
            </div>
            <div class="flex justify-end">
              <Button size="sm" :disabled="!canEdit() || !uploadForm.certPem || !uploadForm.privateKeyPem" :loading="uploadBusy" @click="doUploadCa">Upload &amp; replace</Button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Bootstrap tokens -->
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Bootstrap Tokens</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          A one-time password a device uses exactly once to enroll for its own certificate, bound to its serial number.
          Deploy it via the same Managed Configuration channel as the legacy webhook secret (registry key / plist —
          BootstrapToken field). Shown in full only once, right here, at mint time.
        </p>
        <Alert v-if="store.tokensError" type="danger">{{ store.tokensError }}</Alert>

        <div v-if="store.lastMintedTokens.length > 0" class="p-3 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 space-y-1.5">
          <div class="flex items-center justify-between">
            <p class="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">Copy these now — they won't be shown again</p>
            <button type="button" class="text-[10px] text-gray-500 dark:text-gray-400 underline" @click="store.dismissMintedTokens">Dismiss</button>
          </div>
          <div v-for="t in store.lastMintedTokens" :key="t.id" class="flex items-center gap-1.5">
            <code class="flex-1 min-w-0 px-2 py-1 rounded text-[10px] font-mono overflow-x-auto whitespace-nowrap bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
              {{ t.serialNumber }}: {{ t.token }}
            </code>
            <button type="button" class="p-1.5 rounded border border-gray-200 dark:border-gray-700 shrink-0" @click="copyToken(t.token, t.id)">
              <component v-if="copiedTokenId === t.id" :is="ICONS.CheckCircle" :size="11" weight="Linear" style="color: #10b981" />
              <component v-else :is="ICONS.Copy" :size="11" weight="Linear" />
            </button>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            v-for="m in ['fleet', 'single', 'bulk']"
            :key="m"
            type="button"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors"
            :class="mintMode === m ? 'text-white bg-blue-500 border-blue-500' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'"
            @click="mintMode = m as 'fleet' | 'single' | 'bulk'"
          >
            {{ m === "fleet" ? "From Applivery fleet" : m === "single" ? "Single (manual)" : "Bulk (manual)" }}
          </button>
        </div>

        <template v-if="mintMode === 'fleet'">
          <Alert v-if="store.enrollmentCandidatesError" type="danger">{{ store.enrollmentCandidatesError }}</Alert>
          <Alert v-else-if="store.enrollmentCandidatesAvailable === false" type="warning">
            {{ store.enrollmentCandidatesReason }}
          </Alert>
          <template v-else>
            <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
              Read live from Applivery UEM — no need to know or type serial numbers. Selecting a device here still mints
              it its own one-time token; how that token then reaches the device (imaging, an installer step, a
              provisioning script) is unchanged.
            </p>
            <div class="flex flex-wrap items-center gap-1.5">
              <Input v-model="fleetSearch" placeholder="Search serial or name…" class="flex-1 min-w-[140px]" />
              <select
                v-model="fleetPlatformFilter"
                class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
              >
                <option value="all">All platforms</option>
                <option v-for="p in fleetPlatforms" :key="p" :value="p">{{ p }}</option>
              </select>
              <Button size="sm" variant="ghost" :loading="store.enrollmentCandidatesLoading" @click="store.fetchEnrollmentCandidates()">Refresh</Button>
            </div>
            <label class="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
              <input type="checkbox" v-model="fleetHideEnrolled" /> Hide already-enrolled devices
            </label>

            <p v-if="store.enrollmentCandidatesLoading" class="text-xs text-gray-500 dark:text-gray-400">Loading fleet from Applivery…</p>
            <template v-else>
              <div class="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                <span>{{ filteredFleet.length }} device(s) shown · {{ fleetSelected.size }} selected</span>
                <div class="flex gap-2">
                  <button type="button" class="underline" @click="selectAllVisible">Select all shown</button>
                  <button type="button" class="underline" @click="clearFleetSelection">Clear</button>
                </div>
              </div>
              <div class="max-h-56 overflow-y-auto space-y-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1.5">
                <label
                  v-for="c in filteredFleet"
                  :key="c.serialNumber"
                  class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50"
                >
                  <input type="checkbox" :checked="fleetSelected.has(c.serialNumber)" :disabled="!canEdit()" @change="toggleFleetSelect(c.serialNumber)" />
                  <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="FLEET_STATUS_COLOR[c.mtlsStatus]" />
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium truncate text-gray-900 dark:text-white">{{ c.displayName }}</p>
                    <p class="text-[10px] font-mono text-gray-500 dark:text-gray-400">{{ c.serialNumber }} · {{ c.platform }} · {{ FLEET_STATUS_LABEL[c.mtlsStatus] }}</p>
                  </div>
                </label>
                <p v-if="filteredFleet.length === 0" class="text-xs text-gray-500 dark:text-gray-400 px-2 py-1.5">No matching devices.</p>
              </div>
            </template>
          </template>
        </template>

        <Input v-else-if="mintMode === 'single'" v-model="mintSerial" label="Device serial number" placeholder="PF3ABCDE" :disabled="!canEdit()" />
        <div v-else>
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Device serial numbers (one per line)</label>
          <textarea
            v-model="mintSerialsBulk"
            rows="4"
            :disabled="!canEdit()"
            class="w-full px-2 py-1.5 rounded-lg text-xs font-mono outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
            placeholder="PF3ABCDE&#10;PF3FGHIJ"
          />
        </div>
        <div class="flex items-center gap-2">
          <Input v-model.number="mintExpiresInDays" type="number" min="1" max="30" label="Expires in (days)" class="w-32" :disabled="!canEdit()" />
          <Button
            size="sm"
            class="mt-4"
            :disabled="!canEdit() || !store.caStatus?.configured || (mintMode === 'fleet' && fleetSelected.size === 0)"
            :loading="store.tokenBusy"
            @click="doMint"
          >
            {{ mintMode === "fleet" ? `Mint for ${fleetSelected.size} selected` : "Mint" }}
          </Button>
        </div>
        <Alert v-if="!store.caStatus?.configured" type="warning">Generate or upload a CA above first — tokens can't be minted without one.</Alert>

        <div v-if="store.bootstrapTokens.length > 0" class="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
          <div v-for="t in store.bootstrapTokens" :key="t.id" class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="TOKEN_STATUS_COLOR[t.status]" />
                <span class="text-xs font-mono truncate text-gray-900 dark:text-white">{{ t.serialNumber }}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{{ t.status }}</span>
              </div>
              <p class="text-[10px] text-gray-500 dark:text-gray-400">
                Expires {{ fmt(t.expiresAt) }}<template v-if="t.usedAt"> · used {{ fmt(t.usedAt) }}</template><template v-if="t.createdBy"> · minted by {{ t.createdBy }}</template>
              </p>
            </div>
            <button
              v-if="t.status === 'pending'"
              type="button"
              class="p-1.5 rounded disabled:opacity-40 shrink-0"
              style="color: #ef4444"
              :disabled="!canEdit()"
              @click="doRevokeToken(t.id, t.serialNumber)"
            >
              <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
            </button>
          </div>
        </div>
        <p v-else-if="!store.tokensLoading" class="text-xs text-gray-500 dark:text-gray-400">No bootstrap tokens minted yet.</p>
      </div>
    </div>

    <!-- Self-service enrollment -->
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Self-Service Enrollment</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          For fleets with no way to deliver a unique bootstrap token to each device individually. Deploy ONE shared
          secret via a single Managed Configuration push to the whole fleet — a device proves it's allowed to enroll
          with that secret plus a serial number Applivery currently recognizes as enrolled, instead of a per-device
          token. This is a weaker guarantee than Bootstrap Tokens above: a serial number isn't a secret, so anyone who
          ever obtains this shared secret and a currently-enrolled serial number can request a certificate for it. An
          already-enrolled device can never be silently re-claimed — only a not-yet-enrolled one can be claimed by
          whoever gets there first — which is what keeps "approval required" (below) meaningfully safer than "silent".
        </p>

        <Alert v-if="store.enrollmentSecretError" type="danger">{{ store.enrollmentSecretError }}</Alert>
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0" :class="store.enrollmentSecretStatus?.configured ? 'bg-emerald-500' : 'bg-amber-500'" />
          <span class="text-xs font-semibold text-gray-900 dark:text-white">
            <template v-if="store.enrollmentSecretStatus?.configured">Enrollment secret configured</template>
            <template v-else>No enrollment secret generated yet</template>
          </span>
        </div>

        <div v-if="store.enrollmentSecretStatus?.configured" class="space-y-2">
          <div class="flex items-center gap-1.5">
            <code class="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-nowrap border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white">
              {{ store.enrollmentSecretStatus.secret }}
            </code>
            <button type="button" class="p-2 rounded-lg border shrink-0 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400" @click="copyEnrollmentSecret">
              <component :is="ICONS.Copy" :size="12" weight="Linear" />
            </button>
          </div>
          <p v-if="store.enrollmentSecretStatus.rotatedBy" class="text-[10px] text-gray-500 dark:text-gray-400">
            Last generated by {{ store.enrollmentSecretStatus.rotatedBy }} on {{ fmt(store.enrollmentSecretStatus.rotatedAt) }}
          </p>

          <button type="button" class="text-[10px] font-medium text-blue-600 dark:text-blue-400 underline" @click="showEnrollmentSnippet = !showEnrollmentSnippet">
            {{ showEnrollmentSnippet ? "Hide" : "Show" }} Managed Configuration snippet (Windows)
          </button>
          <div v-if="showEnrollmentSnippet" class="space-y-1.5">
            <code class="block px-2.5 py-2 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto whitespace-pre border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white">{{ windowsEnrollmentSnippet }}</code>
            <div class="flex gap-1.5">
              <Button size="sm" variant="ghost" @click="downloadEnrollmentSnippet">Download .ps1</Button>
              <Button size="sm" variant="ghost" @click="copyEnrollmentSnippet">Copy</Button>
            </div>
            <p class="text-[10px] leading-relaxed text-gray-400">
              Paste into Applivery Dashboard &gt; Resources &gt; Scripts &gt; Create Script, then assign to the Policy
              covering this fleet (Scope: Machine, Execution: Once) — deploys to every enrolled device at next sync.
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button v-if="store.enrollmentSecretStatus?.configured" variant="ghost" size="sm" :disabled="!canEdit()" :loading="store.enrollmentSecretBusy" @click="doClearEnrollmentSecret">Remove</Button>
          <Button size="sm" :disabled="!canEdit()" :loading="store.enrollmentSecretBusy" @click="doRotateEnrollmentSecret">
            {{ store.enrollmentSecretStatus?.configured ? "Rotate secret" : "Generate enrollment secret" }}
          </Button>
        </div>

        <div class="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400">Mode</label>
          <Alert v-if="store.selfServiceModeError" type="danger">{{ store.selfServiceModeError }}</Alert>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="m in (['disabled', 'approval', 'silent'] as SelfServiceMode[])"
              :key="m"
              type="button"
              :disabled="!canEdit() || store.selfServiceModeBusy"
              class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50"
              :class="store.selfServiceMode === m ? 'text-white bg-blue-500 border-blue-500' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'"
              @click="doSetSelfServiceMode(m)"
            >
              {{ MODE_LABEL[m] }}
            </button>
          </div>
          <p class="text-[10px] leading-relaxed text-gray-400">{{ MODE_DESCRIPTION[store.selfServiceMode ?? "disabled"] }}</p>
        </div>

        <div v-if="store.selfServiceMode === 'approval'" class="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <div class="flex items-center justify-between">
            <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400">Pending enrollment requests</p>
            <Button size="sm" variant="ghost" :loading="store.enrollmentRequestsLoading" @click="store.fetchEnrollmentRequests()">Refresh</Button>
          </div>
          <Alert v-if="store.enrollmentRequestsError" type="danger">{{ store.enrollmentRequestsError }}</Alert>
          <div v-if="store.enrollmentRequests.filter((r) => r.status === 'pending').length > 0" class="space-y-1.5">
            <div
              v-for="r in store.enrollmentRequests.filter((r) => r.status === 'pending')"
              :key="r.id"
              class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50"
            >
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium truncate text-gray-900 dark:text-white">{{ r.displayName || r.serialNumber }}</p>
                <p class="text-[10px] font-mono text-gray-500 dark:text-gray-400">{{ r.serialNumber }} · requested {{ fmt(r.requestedAt) }}</p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="ghost" :disabled="!canEdit()" :loading="store.enrollmentRequestBusy" @click="doRejectRequest(r.id, r.serialNumber)">Reject</Button>
                <Button size="sm" :disabled="!canEdit()" :loading="store.enrollmentRequestBusy" @click="doApproveRequest(r.id, r.serialNumber)">Approve</Button>
              </div>
            </div>
          </div>
          <p v-else-if="!store.enrollmentRequestsLoading" class="text-xs text-gray-500 dark:text-gray-400">No pending requests.</p>
        </div>
      </div>
    </div>

    <!-- Issued certificates -->
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Issued Device Certificates</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-2 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          The fleet-migration dashboard — check this covers every device before flipping enforcement on below.
        </p>
        <Alert v-if="store.certsError" type="danger">{{ store.certsError }}</Alert>
        <div v-if="store.certificates.length > 0" class="space-y-1.5">
          <div v-for="c in store.certificates" :key="c.id" class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="CERT_STATUS_COLOR[c.status]" />
                <span class="text-xs font-mono truncate text-gray-900 dark:text-white">{{ c.serialNumber }}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{{ c.status }}</span>
              </div>
              <p class="text-[10px] text-gray-500 dark:text-gray-400">
                Issued {{ fmt(c.issuedAt) }} · valid until {{ fmt(c.notAfter) }}
                <template v-if="c.revokedAt"> · revoked {{ fmt(c.revokedAt) }} ({{ c.revokedReason }})</template>
              </p>
            </div>
            <button
              v-if="c.status === 'active' || c.status === 'expiring-soon'"
              type="button"
              class="p-1.5 rounded disabled:opacity-40 shrink-0"
              style="color: #ef4444"
              :disabled="!canEdit()"
              @click="doRevokeCert(c.id, c.serialNumber)"
            >
              <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
            </button>
          </div>
        </div>
        <p v-else-if="!store.certsLoading" class="text-xs text-gray-500 dark:text-gray-400">No devices have registered yet.</p>
      </div>
    </div>

    <!-- Enforcement cutover -->
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Enforcement</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          Off by default: both the legacy X-Device-Report-Secret and mTLS certificates work side by side, and each
          device migrates independently the moment it registers. Turning this on is the hard cutover — the 6
          device-caller routes stop accepting the legacy secret for this workspace entirely, and any device without a
          valid certificate goes dark until it registers. There's no partial/dual-accept mode once this is on.
        </p>
        <Alert v-if="store.enforcementError" type="danger">{{ store.enforcementError }}</Alert>
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0" :class="store.enforcementEnabled ? 'bg-red-500' : 'bg-emerald-500'" />
          <span class="text-xs font-semibold text-gray-900 dark:text-white">
            {{ store.enforcementEnabled ? "mTLS enforcement is ON — legacy secret rejected" : "mTLS enforcement is OFF — legacy secret still accepted" }}
          </span>
        </div>
        <div class="flex justify-end">
          <Button
            size="sm"
            :variant="store.enforcementEnabled ? 'ghost' : undefined"
            :disabled="!canEdit() || (!store.enforcementEnabled && !store.caStatus?.configured)"
            :loading="store.enforcementBusy"
            @click="doToggleEnforcement"
          >
            {{ store.enforcementEnabled ? "Disable enforcement" : "Enable enforcement" }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
