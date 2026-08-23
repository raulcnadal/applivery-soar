<script setup lang="ts">
// "mTLS Agent Authentication" tab — disclosed new feature, no main.py/App.jsx
// equivalent. Admin surface for backend/docs/mtls-agent-auth-roadmap.md's
// full design: the workspace's Certificate Authority (generate or upload),
// the single Global Bootstrap Token every device in the fleet uses to
// register for its own client certificate, the reverse-proxy config
// reference, the resulting fleet of issued device certificates, and the
// Phase C cutover switch that makes mTLS mandatory instead of optional on
// the 6 device-caller routes (deviceData.controller.ts). Every mutating
// action here requires the canManageMtlsCA risky-action flag
// (rbac.middleware.ts / RoleDialog.vue) — replacing the CA, rotating the
// fleet's bootstrap token, or flipping enforcement are exactly the class of
// consequential, hard-to-reverse action that flag category exists for.
//
// Superseded the original per-device Bootstrap Tokens section (Phase A/B/D
// fleet picker) and the Phase E "Self-Service Enrollment" shared-secret +
// mode addendum — both retired in favor of the single Global Bootstrap
// Token below, which does what both of those were trying to do (fleet-wide
// deployment, live Applivery serial-number check, per-device unique certs)
// without the extra per-device minting step or the approval-queue mode a
// bootstrap token doesn't need (unattended by design).
import { computed, onMounted, reactive, ref, watch } from "vue";
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useAuthStore } from "../../stores/auth";
import { useMtlsStore } from "../../stores/mtls";
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
  if (replace && !confirm("Replace the existing Certificate Authority? Every currently-issued device certificate's chain of trust becomes invalid immediately — devices will need to re-register with the bootstrap token.")) {
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

// The CA cert (public material, no private key) is what a reverse proxy needs for
// `ssl_client_certificate` — download-as-file mirrors Device Data Webhook's snippet
// pattern so admins have one consistent way to pull config material out of Settings.
function downloadCaCert() {
  const pem = store.caStatus?.certPem;
  if (!pem) return;
  const blob = new Blob([pem], { type: "application/x-pem-file" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "soar-ca.pem";
  a.click();
  URL.revokeObjectURL(url);
}
const caCertCopied = ref(false);
async function copyCaCert() {
  const pem = store.caStatus?.certPem;
  if (!pem) return;
  const ok = await copyToClipboard(pem);
  if (ok) {
    caCertCopied.value = true;
    setTimeout(() => { caCertCopied.value = false; }, 2000);
  } else {
    alert("Couldn't copy automatically — this usually happens when the dashboard is loaded over plain HTTP instead of HTTPS. Use the download button instead.");
  }
}

// ── Global Bootstrap Token ──
// The single, workspace-wide credential every device in the fleet uses to
// register — see globalBootstrapToken.service.ts's module doc (backend) for
// the full security model. Deploying it is handled entirely from Device
// Data Webhook's combined Managed Configuration download, not here — this
// panel only owns the token's lifecycle (generate/rotate/remove) and status.

async function doRotateBootstrapToken() {
  const replacing = Boolean(store.bootstrapTokenStatus?.configured);
  if (replacing && !confirm("Rotate the global bootstrap token? Any device that hasn't registered yet and hasn't picked up the new value from Managed Configuration will fail to register until it does. Already-registered devices are unaffected.")) return;
  await store.rotateBootstrapToken();
}
async function doClearBootstrapToken() {
  if (!confirm("Remove the global bootstrap token? No device can register for a new certificate until a new token is generated. Already-registered devices are unaffected.")) return;
  await store.clearBootstrapToken();
}
function copyBootstrapToken() {
  if (store.bootstrapTokenStatus?.secret) copyToClipboard(store.bootstrapTokenStatus.secret);
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

// Fleet-wide, so the inline card only ever shows a status-count summary —
// the full browsable list lives in a dedicated, wide Modal instead, split
// into Active/Revoked sections (each independently paginated + searchable
// server-side — see mtls.ts's fetchCertificates doc comment), since a
// growing fleet quickly makes a plain "load everything" list both too tall
// for the Settings panel and too slow to fetch at all.
const showCertsModal = ref(false);
const showProxyModal = ref(false);
// Collapsed by default, per the redesign — a fleet with real device churn
// accumulates far more revoked history than an admin needs to see by
// default; expanding lazy-loads it the first time (see the watcher below).
const revokedExpanded = ref(false);

const activeSearchInput = ref("");
const revokedSearchInput = ref("");
let activeSearchDebounce: ReturnType<typeof setTimeout> | null = null;
let revokedSearchDebounce: ReturnType<typeof setTimeout> | null = null;
watch(activeSearchInput, (val) => {
  if (activeSearchDebounce) clearTimeout(activeSearchDebounce);
  activeSearchDebounce = setTimeout(() => void store.setCertSearch("active", val), 300);
});
watch(revokedSearchInput, (val) => {
  if (revokedSearchDebounce) clearTimeout(revokedSearchDebounce);
  revokedSearchDebounce = setTimeout(() => void store.setCertSearch("revoked", val), 300);
});

watch(showCertsModal, (open) => {
  if (open && store.activeCerts.items.length === 0 && !store.activeCerts.loading) void store.fetchCertificates("active");
});
function toggleRevokedSection() {
  revokedExpanded.value = !revokedExpanded.value;
  if (revokedExpanded.value && store.revokedCerts.items.length === 0 && !store.revokedCerts.loading) void store.fetchCertificates("revoked");
}

// ── Purge old revoked certificates ──

const purgeRetentionInput = ref(90);
const purgeScheduleEnabled = ref(false);
const purgeScheduleDirty = ref(false);
const purgeNowDays = ref(90);
const purgeBusy = ref(false);
watch(() => store.certPurgeSettings, (settings) => {
  if (!settings) return;
  purgeRetentionInput.value = settings.retentionDays;
  purgeScheduleEnabled.value = settings.enabled;
  purgeScheduleDirty.value = false;
  purgeNowDays.value = settings.retentionDays;
});

async function doSavePurgeSchedule() {
  purgeBusy.value = true;
  try {
    await store.saveCertPurgeSettings({ enabled: purgeScheduleEnabled.value, retentionDays: purgeRetentionInput.value });
    purgeScheduleDirty.value = false;
  } catch {
    // Surfaced via store.certPurgeSettingsError in the template.
  } finally {
    purgeBusy.value = false;
  }
}

async function doPurgeNow() {
  const revokedCount = store.certCounts?.revoked ?? 0;
  if (!confirm(`Permanently delete every revoked device certificate older than ${purgeNowDays.value} day(s)? Up to ${revokedCount} revoked certificate(s) exist in total; this cannot be undone.`)) return;
  try {
    await store.purgeRevokedCertificatesNow(purgeNowDays.value);
  } catch {
    // Surfaced via store.certPurgeError in the template.
  }
}

// ── Reverse-proxy config reference ──
//
// ssl_verify_client / ssl_client_certificate are TLS-handshake directives —
// nginx (and most reverse proxies) can't scope them to a single location/path,
// only to the whole domain. Adding them to the existing dashboard proxy host
// would put every connection to that domain through client-cert negotiation,
// breaking normal browser access to the dashboard. The fix is a SEPARATE
// subdomain/vhost dedicated to agent traffic, so the dashboard domain never
// carries a client-cert directive at all — every agent's Managed
// Configuration BaseURL points at that subdomain instead.

// Editable, saved to the backend (single source of truth — Device Data
// Webhook reads this back read-only). Local draft starts from whatever's
// already saved, falling back to a suggested value only when nothing is
// saved yet; onMounted's fetchAgentSubdomain() below overwrites this once
// the real value loads.
const agentSubdomainInput = ref(`agents.${window.location.hostname}`);
const agentSubdomainDirty = ref(false);
watch(() => store.agentSubdomain, (value) => {
  agentSubdomainInput.value = value ?? `agents.${window.location.hostname}`;
  agentSubdomainDirty.value = false;
});
async function doSaveAgentSubdomain() {
  try {
    await store.setAgentSubdomain(agentSubdomainInput.value.trim() || null);
    agentSubdomainDirty.value = false;
  } catch {
    // Surfaced via store.agentSubdomainError in the template.
  }
}

const proxySnippet = computed(() => {
  const c = store.proxyConfig;
  if (!c) return "";
  const domain = store.agentSubdomain || agentSubdomainInput.value;
  return `# A NEW, SEPARATE Nginx Proxy Manager proxy host — Domain: ${domain}
# Do NOT add any of this to your existing dashboard proxy host (${window.location.hostname}).
# TLS client-certificate verification applies to the whole domain it's configured on, not
# to a single path — so this must live on its own subdomain that only ever serves agent
# traffic (registration/renewal + reporting), never the dashboard or browser traffic.
#
# Details tab: Forward Hostname/Port — same target as your existing SOAR proxy host.
#
# Use NPM's own UI structure below, not a hand-written location{} block in the host-level
# Advanced field — the "Advanced" gear icon on the Details tab and each entry under
# "Custom Locations" are separate fields that NPM assembles itself.
#
# STEP 1 — Details tab's own "Advanced" gear icon (server-level only, no location block):
ssl_verify_client optional;   # "optional" not "on" — registration has no cert yet, and
                               # reporting is only cert-gated once Enforcement below is on;
                               # the backend decides per request whether one is required.
ssl_client_certificate /data/soar-ca.pem;   # download above (Certificate Authority > Download CA
                               # certificate). Path is read inside the NPM container — bind-mount
                               # the file under a volume your compose file actually persists
                               # (e.g. /data), not NPM's own non-persisted app directory.
                               # Verify: docker exec <npm-container> ls -la /data/soar-ca.pem

# STEP 2 — Custom Locations tab — Add Location:
#   Location: /api/
#   Forward Hostname/Port: same as this host's own Details tab
#   Then click THAT location's own gear icon and paste this (no location{} wrapper — NPM
#   generates that itself from the Location field above):
proxy_set_header ${c.headerCertVerified} $ssl_client_verify;
proxy_set_header ${c.headerCertCn}       $ssl_client_s_dn;
                               # nginx only exposes the full subject DN via $ssl_client_s_dn
                               # (e.g. "CN=<value>") — the backend parses the CN back out of it.
proxy_set_header ${c.headerProxySecret} "<the MTLS_INTERNAL_PROXY_SECRET value>";
                               # Pull this value directly from the backend's own environment —
                               # e.g. docker exec <soar-backend-container> printenv MTLS_INTERNAL_PROXY_SECRET
                               # — and paste that output as-is rather than retyping it by hand.`;
});
function copyProxySnippet() {
  copyToClipboard(proxySnippet.value);
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
  await store.fetchBootstrapTokenStatus();
  // Cheap counts only here — the full Active/Revoked lists lazy-load the
  // first time the modal (and, for Revoked, its collapsed section) opens.
  await store.fetchCertCounts();
  await store.fetchCertPurgeSettings();
  await store.fetchEnforcement();
  await store.fetchProxyConfig();
  await store.fetchAgentSubdomain();
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">mTLS Agent Authentication</h3>
      <p class="text-[11px] leading-relaxed mb-3 text-gray-500 dark:text-gray-400">
        Replaces the shared X-Device-Report-Secret with per-device client certificates: each device generates its own
        keypair, registers once using the workspace's Global Bootstrap Token, and from then on authenticates with a
        short-lived cert that renews itself automatically. The reverse proxy in front of this backend (nginx/NPM,
        Traefik, Caddy, HAProxy — any TLS-terminating proxy) must be configured to request and forward the client cert
        — see Reverse Proxy Configuration below. Fully additive until you flip enforcement on at the bottom.
      </p>
      <div class="space-y-2">
        <Alert v-if="!canEdit()" type="info">Your role doesn't have the canManageMtlsCA permission — every control below is read-only.</Alert>
        <Alert type="info">
          Ready to push this to the fleet? <button type="button" class="underline font-semibold" @click="emit('goToTab', 'device-webhook')">Applivery SOAR Agent</button>
          combines the token/CA status here with the reporting toggles into one downloadable Managed Configuration bundle
          — there's no separate download here.
        </Alert>
      </div>
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

          <div v-if="store.caStatus?.configured" class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p class="text-[10px] leading-relaxed text-gray-400 max-w-xs">
              Public cert only — needed by your reverse proxy's <code>ssl_client_certificate</code> directive. See
              Reverse Proxy Configuration below.
            </p>
            <div class="flex gap-1.5 shrink-0">
              <Button variant="ghost" size="sm" @click="downloadCaCert">Download CA certificate</Button>
              <Button variant="ghost" size="sm" @click="copyCaCert">
                <component v-if="caCertCopied" :is="ICONS.CheckCircle" :size="12" weight="Linear" style="color: #10b981" />
                <component v-else :is="ICONS.Copy" :size="12" weight="Linear" />
              </Button>
            </div>
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

    <!-- Global Bootstrap Token -->
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Global Bootstrap Token</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          One value, the SAME on every device — deploy it once via a single Managed Configuration push to the whole
          fleet (the Applivery SOAR Agent panel's download includes it automatically once generated here). A device proves it's
          allowed to register with this token PLUS a live check that its own serial number is currently a known,
          enrolled device in this workspace's Applivery UEM fleet — only devices Applivery already knows about can
          ever register. Issued immediately on success, no admin approval step (a bootstrap token is unattended by
          design). A device that already has an active certificate can never be silently re-registered — only an
          admin revoking it first opens the door again.
        </p>

        <Alert v-if="store.bootstrapTokenError" type="danger">{{ store.bootstrapTokenError }}</Alert>
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0" :class="store.bootstrapTokenStatus?.configured ? 'bg-emerald-500' : 'bg-amber-500'" />
          <span class="text-xs font-semibold text-gray-900 dark:text-white">
            <template v-if="store.bootstrapTokenStatus?.configured">Bootstrap token configured</template>
            <template v-else>No bootstrap token generated yet</template>
          </span>
        </div>

        <div v-if="store.bootstrapTokenStatus?.configured" class="space-y-2">
          <div class="flex items-center gap-1.5">
            <code class="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-nowrap border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white">
              {{ store.bootstrapTokenStatus.secret }}
            </code>
            <button type="button" class="p-2 rounded-lg border shrink-0 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400" @click="copyBootstrapToken">
              <component :is="ICONS.Copy" :size="12" weight="Linear" />
            </button>
          </div>
          <p v-if="store.bootstrapTokenStatus.rotatedBy" class="text-[10px] text-gray-500 dark:text-gray-400">
            Last generated by {{ store.bootstrapTokenStatus.rotatedBy }} on {{ fmt(store.bootstrapTokenStatus.rotatedAt) }}
          </p>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button v-if="store.bootstrapTokenStatus?.configured" variant="ghost" size="sm" :disabled="!canEdit()" :loading="store.bootstrapTokenBusy" @click="doClearBootstrapToken">Remove</Button>
          <Button size="sm" :disabled="!canEdit()" :loading="store.bootstrapTokenBusy" @click="doRotateBootstrapToken">
            {{ store.bootstrapTokenStatus?.configured ? "Rotate token" : "Generate token" }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Reverse proxy configuration -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-bold text-gray-900 dark:text-white">Reverse Proxy Configuration</h3>
        <Button variant="ghost" size="sm" @click="showProxyModal = true">View configuration</Button>
      </div>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-2 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          The proxy in front of this backend terminates the mTLS handshake and forwards the verified client identity
          as headers. Required before enforcement below will actually work; without it every mTLS-gated request
          fails closed (503).
        </p>
        <Alert v-if="store.proxyConfigError" type="danger">{{ store.proxyConfigError }}</Alert>
        <div v-if="store.proxyConfig" class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0" :class="store.proxyConfig.proxySecretConfigured ? 'bg-emerald-500' : 'bg-red-500'" />
          <span class="text-xs font-semibold text-gray-900 dark:text-white">
            {{ store.proxyConfig.proxySecretConfigured ? "Internal proxy secret is configured on this backend" : "Internal proxy secret is NOT configured — mTLS-gated requests fail closed" }}
          </span>
        </div>
      </div>
    </div>

    <Modal :open="showProxyModal" title="Reverse Proxy Configuration" size="lg" class="max-w-4xl" @close="showProxyModal = false">
      <div class="space-y-3 max-h-[70vh] overflow-y-auto pr-4 -mr-6">
        <Alert type="warning">
          TLS client-certificate verification applies to an entire domain, not a URL path — nginx (and most reverse
          proxies) can't scope it to a location block. Adding it to your existing dashboard's proxy host breaks
          normal browser access to the dashboard. It must live on a <strong>separate subdomain</strong> dedicated to
          agent traffic — see the reference config below.
        </Alert>
        <Alert v-if="store.agentSubdomainError" type="danger">{{ store.agentSubdomainError }}</Alert>
        <div>
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Agent subdomain</label>
          <div class="flex items-center gap-2">
            <Input
              v-model="agentSubdomainInput"
              type="text"
              :disabled="!canEdit()"
              class="flex-1 font-mono text-[11px]"
              @update:model-value="agentSubdomainDirty = true"
            />
            <Button size="sm" variant="ghost" :disabled="!canEdit() || !agentSubdomainDirty" :loading="store.agentSubdomainBusy" @click="doSaveAgentSubdomain">Save</Button>
          </div>
          <p class="text-[10px] mt-1 leading-relaxed text-gray-400">
            A new hostname you create a DNS record and a separate Nginx Proxy Manager proxy host for — never your
            existing dashboard domain. This is the single source of truth: once saved, every agent's Managed
            Configuration
            <button type="button" class="underline decoration-dotted" @click="emit('goToTab', 'device-webhook')">Agent Base URL</button>
            picks it up automatically (read-only there).
          </p>
        </div>
        <p class="text-[10px] leading-relaxed text-gray-400">
          Reference config for nginx/NPM (Traefik/Caddy/HAProxy need the same three values via their own
          equivalents: trust the SOAR CA cert, forward the verification result + client cert CN as headers, inject
          the shared secret). The internal proxy secret's actual value is never shown here — it's set as the
          <span class="font-mono">MTLS_INTERNAL_PROXY_SECRET</span> environment variable on this backend's own
          deployment, which you already control.
        </p>
        <div class="flex items-start gap-1.5">
          <code class="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto whitespace-pre border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white">{{ proxySnippet }}</code>
          <Button size="sm" variant="ghost" @click="copyProxySnippet">Copy</Button>
        </div>
      </div>
    </Modal>

    <!-- Issued certificates -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-bold text-gray-900 dark:text-white">Issued Device Certificates</h3>
        <Button v-if="(store.certCounts?.active ?? 0) + (store.certCounts?.revoked ?? 0) > 0" variant="ghost" size="sm" @click="showCertsModal = true">
          View all ({{ (store.certCounts?.active ?? 0) + (store.certCounts?.revoked ?? 0) }})
        </Button>
      </div>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-2 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          The fleet-migration dashboard — check this covers every device before flipping enforcement on below.
        </p>
        <div v-if="store.certCounts && store.certCounts.active + store.certCounts.revoked > 0" class="flex flex-wrap items-center gap-1.5">
          <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-300">
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="CERT_STATUS_COLOR.active" />
            {{ store.certCounts.active }} active
          </span>
          <span v-if="store.certCounts.revoked > 0" class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-300">
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="CERT_STATUS_COLOR.revoked" />
            {{ store.certCounts.revoked }} revoked
          </span>
        </div>
        <p v-else-if="!store.certCountsLoading" class="text-xs text-gray-500 dark:text-gray-400">No devices have registered yet.</p>
      </div>
    </div>

    <Modal :open="showCertsModal" title="Issued Device Certificates" size="lg" class="max-w-5xl" @close="showCertsModal = false">
      <div class="space-y-4">
        <!-- Active section -->
        <div>
          <div class="flex items-center justify-between gap-2 mb-2">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Active Device Certificates ({{ store.activeCerts.total }})</h4>
          </div>
          <div class="relative mb-2">
            <component :is="ICONS.Magnifer" :size="13" weight="Linear" class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
            <input
              v-model="activeSearchInput"
              type="text"
              placeholder="Search by serial number or thumbprint…"
              class="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <Alert v-if="store.activeCerts.error" type="danger">{{ store.activeCerts.error }}</Alert>
          <div class="space-y-1.5 max-h-[40vh] overflow-y-auto">
            <div v-for="c in store.activeCerts.items" :key="c.id" class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="CERT_STATUS_COLOR[c.status]" />
                  <span class="text-xs font-semibold truncate text-gray-900 dark:text-white">{{ c.deviceDisplayName || "Unmatched device" }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{{ c.status }}</span>
                </div>
                <p class="text-[10px] font-mono truncate text-gray-500 dark:text-gray-400">
                  S/N {{ c.serialNumber }}
                  <template v-if="c.thumbprint">
                    · SHA-256 <span :title="c.thumbprint">{{ c.thumbprint }}</span>
                  </template>
                </p>
                <p class="text-[10px] text-gray-500 dark:text-gray-400">
                  <template v-if="c.employeeName">{{ c.employeeName }} · </template>Issued {{ fmt(c.issuedAt) }} · valid until {{ fmt(c.notAfter) }}
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
            <p v-if="!store.activeCerts.loading && store.activeCerts.items.length === 0" class="text-xs text-center py-4 text-gray-400">
              {{ activeSearchInput ? "No matching active certificates." : "No active certificates." }}
            </p>
            <p v-if="store.activeCerts.loading" class="text-xs text-center py-4 text-gray-400">Loading…</p>
          </div>
          <div v-if="store.activeCerts.hasMore" class="flex justify-center pt-2">
            <Button size="sm" variant="ghost" :loading="store.activeCerts.loading" @click="store.fetchCertificates('active', { append: true })">
              Load more ({{ store.activeCerts.items.length }} of {{ store.activeCerts.total }})
            </Button>
          </div>
        </div>

        <!-- Revoked section — collapsed by default -->
        <div class="pt-3 border-t border-gray-100 dark:border-gray-800">
          <button type="button" class="flex items-center gap-1.5 w-full text-left mb-2" @click="toggleRevokedSection">
            <component :is="revokedExpanded ? ICONS.AltArrowDown : ICONS.AltArrowRight" :size="13" weight="Linear" class="text-gray-400" />
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Revoked ({{ store.certCounts?.revoked ?? store.revokedCerts.total }})</h4>
          </button>
          <template v-if="revokedExpanded">
            <div class="relative mb-2">
              <component :is="ICONS.Magnifer" :size="13" weight="Linear" class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
              <input
                v-model="revokedSearchInput"
                type="text"
                placeholder="Search by serial number or thumbprint…"
                class="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <Alert v-if="store.revokedCerts.error" type="danger">{{ store.revokedCerts.error }}</Alert>
            <div class="space-y-1.5 max-h-[40vh] overflow-y-auto">
              <div v-for="c in store.revokedCerts.items" :key="c.id" class="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="CERT_STATUS_COLOR.revoked" />
                    <span class="text-xs font-semibold truncate text-gray-900 dark:text-white">{{ c.deviceDisplayName || "Unmatched device" }}</span>
                  </div>
                  <p class="text-[10px] font-mono truncate text-gray-500 dark:text-gray-400">
                    S/N {{ c.serialNumber }}
                    <template v-if="c.thumbprint">
                      · SHA-256 <span :title="c.thumbprint">{{ c.thumbprint }}</span>
                    </template>
                  </p>
                  <p class="text-[10px] text-gray-500 dark:text-gray-400">
                    <template v-if="c.employeeName">{{ c.employeeName }} · </template>revoked {{ fmt(c.revokedAt) }} ({{ c.revokedReason }})
                  </p>
                </div>
              </div>
              <p v-if="!store.revokedCerts.loading && store.revokedCerts.items.length === 0" class="text-xs text-center py-4 text-gray-400">
                {{ revokedSearchInput ? "No matching revoked certificates." : "No revoked certificates." }}
              </p>
              <p v-if="store.revokedCerts.loading" class="text-xs text-center py-4 text-gray-400">Loading…</p>
            </div>
            <div v-if="store.revokedCerts.hasMore" class="flex justify-center pt-2">
              <Button size="sm" variant="ghost" :loading="store.revokedCerts.loading" @click="store.fetchCertificates('revoked', { append: true })">
                Load more ({{ store.revokedCerts.items.length }} of {{ store.revokedCerts.total }})
              </Button>
            </div>
          </template>
        </div>

        <!-- Purge old revoked certificates -->
        <div class="pt-3 border-t border-gray-100 dark:border-gray-800">
          <h4 class="text-xs font-bold mb-1 text-gray-900 dark:text-white">Remove old revoked certificates</h4>
          <p class="text-[11px] leading-relaxed mb-2 text-gray-500 dark:text-gray-400">
            Permanently deletes revoked certificate rows — never active ones — past the age below. This is a hard delete, not another revocation; it can't be undone.
          </p>
          <Alert v-if="store.certPurgeSettingsError" type="danger">{{ store.certPurgeSettingsError }}</Alert>
          <Alert v-if="store.certPurgeError" type="danger">{{ store.certPurgeError }}</Alert>
          <Alert v-if="store.certPurgeLastResult" type="success">{{ store.certPurgeLastResult.purged }} revoked certificate(s) permanently deleted.</Alert>
          <div class="flex flex-wrap items-end gap-3">
            <label class="flex items-center gap-2 text-xs font-medium cursor-pointer text-gray-900 dark:text-white">
              <input v-model="purgeScheduleEnabled" type="checkbox" :disabled="!canEdit()" @change="purgeScheduleDirty = true" /> Automatically purge on a daily schedule
            </label>
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Older than (days)</label>
              <Input v-model.number="purgeRetentionInput" type="number" min="1" :disabled="!canEdit()" class="w-24" @update:model-value="purgeScheduleDirty = true" />
            </div>
            <Button size="sm" variant="ghost" :disabled="!canEdit() || !purgeScheduleDirty" :loading="purgeBusy" @click="doSavePurgeSchedule">Save schedule</Button>
            <span class="flex-1" />
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Purge now — older than (days)</label>
              <Input v-model.number="purgeNowDays" type="number" min="1" :disabled="!canEdit()" class="w-24" />
            </div>
            <Button size="sm" :disabled="!canEdit()" :loading="store.certPurgeBusy" @click="doPurgeNow">Purge now</Button>
          </div>
        </div>
      </div>
    </Modal>

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
            {{ store.enforcementEnabled ? "mTLS enforcement is ON" : "mTLS enforcement is OFF — legacy secret still accepted" }}
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
