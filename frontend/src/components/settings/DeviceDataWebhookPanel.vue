<script setup lang="ts">
// Device Data Webhook tab. Port of App.jsx:6108-6238 (Device Data Webhook +
// App Inventory Reporting + Security Attestation Reporting cards) / main.py:
// 7799-7897. The actual receiver endpoints (POST /api/device-data/report,
// /report-apps) are backend's deviceData.controller.ts (Phase 8) — this
// panel covers the secret lifecycle + script downloads.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useDeviceReportSecretStore } from "../../stores/deviceReportSecret";
import { useAgentDownloadsStore, type AgentAsset } from "../../stores/agentDownloads";

const store = useDeviceReportSecretStore();
const auth = useAuthStore();
const agentStore = useAgentDownloadsStore();
const busy = ref(false);
const downloading = ref<string | null>(null);
const downloadingSecurity = ref<string | null>(null);

const canEdit = () => auth.hasRiskyAction("canEditIntegrationSecrets");
const githubTokenInput = ref("");
const tokenBusy = ref(false);
const tokenSaved = ref(false);
const downloadingAsset = ref<number | null>(null);

const webhookUrl = computed(() => `${window.location.origin}/api/device-data/report`);
const exampleJsonBody = `{
  "platform": "windows",
  "serialNumber": "PF3ABCDE",
  "attributes": {
    "BitLockerStatus": true,
    "FirewallEnabled": true,
    "OsBuild": "22631.3527"
  }
}`;

async function rotate() {
  busy.value = true;
  try { await store.rotate(); } finally { busy.value = false; }
}
async function clear() {
  busy.value = true;
  try { await store.clear(); } finally { busy.value = false; }
}
async function download(kind: "apps" | "security", platform: string) {
  if (kind === "apps") downloading.value = platform;
  else downloadingSecurity.value = platform;
  try {
    await store.downloadScript(kind, platform, auth.orgSlug ?? "global");
  } finally {
    if (kind === "apps") downloading.value = null;
    else downloadingSecurity.value = null;
  }
}
function copyUrl() {
  navigator.clipboard.writeText(webhookUrl.value);
}
function copyHeaders() {
  const secret = store.status?.secret ?? "";
  navigator.clipboard.writeText(`X-Workspace-Slug: ${auth.orgSlug}\nX-Device-Report-Secret: ${secret}`);
}

// Managed Configuration snippets for the native agents — generated entirely
// client-side, same trust model as downloadScript() above: the plaintext
// secret is already sitting in store.status.secret, nothing new to fetch.
// The agent binaries themselves carry no workspace-specific data (see each
// repo's fix for the hardcoded-secret issue) — only these snippets do.
const windowsRegSnippet = computed(() => {
  const secret = store.status?.secret ?? "";
  return `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Applivery\\SOAR]
"BaseURL"="${window.location.origin}"
"WorkspaceSlug"="${auth.orgSlug}"
"ReportSecret"="${secret}"
"ReportBitLocker"=dword:00000001
"ReportFirewall"=dword:00000001
"ReportApps"=dword:00000001
"IntervalSec"=dword:00000e10
`;
});
const macosConfigSnippet = computed(() => {
  const secret = store.status?.secret ?? "";
  return JSON.stringify(
    {
      base_url: window.location.origin,
      workspace_slug: auth.orgSlug,
      report_secret: secret,
      interval_sec: 3600,
      report_bitlocker: true,
      report_firewall: true,
      report_apps: true,
    },
    null,
    2,
  );
});
function downloadSnippet(platform: "windows" | "macos") {
  const content = platform === "windows" ? windowsRegSnippet.value : macosConfigSnippet.value;
  const filename = platform === "windows" ? "applivery-soar-agent.reg" : "es.mi-labs.soar.agent.json";
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function copySnippet(platform: "windows" | "macos") {
  navigator.clipboard.writeText(platform === "windows" ? windowsRegSnippet.value : macosConfigSnippet.value);
}

async function saveGithubToken() {
  if (!githubTokenInput.value.trim()) return;
  tokenBusy.value = true;
  tokenSaved.value = false;
  try {
    await agentStore.setToken(githubTokenInput.value.trim());
    githubTokenInput.value = "";
    tokenSaved.value = true;
  } finally {
    tokenBusy.value = false;
  }
}
async function clearGithubToken() {
  tokenBusy.value = true;
  try {
    await agentStore.clearToken();
  } finally {
    tokenBusy.value = false;
  }
}
async function downloadAgentAsset(asset: AgentAsset) {
  downloadingAsset.value = asset.assetId;
  try {
    await agentStore.downloadAsset(asset);
  } finally {
    downloadingAsset.value = null;
  }
}
function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
const platformLabels: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
};

onMounted(async () => {
  await store.fetchStatus();
  await agentStore.fetchConfig();
  await agentStore.fetchAssets();
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Device Data Webhook</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          Lets a scheduled script on a Windows or macOS device push extra attributes (disk encryption, firewall, patch status, anything) that aren't in
          Applivery's own data. Reports are matched to a device by serial number and become available to Compliance Policies as "Self-Reported Attribute"
          conditions.
        </p>
        <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

        <p v-if="!store.status" class="text-xs text-gray-500 dark:text-gray-400">Checking status…</p>
        <template v-else>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full shrink-0" :class="store.status.configured ? 'bg-emerald-500' : 'bg-amber-500'" />
            <span class="text-xs font-semibold text-gray-900 dark:text-white">
              <template v-if="store.status.configured">Webhook active for <span class="font-mono">{{ auth.orgSlug }}</span></template>
              <template v-else>Not configured for this workspace</template>
            </span>
          </div>

          <div v-if="store.status.configured" class="space-y-2">
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Webhook URL</label>
              <div class="flex items-center gap-1.5 min-w-0">
                <code class="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-nowrap border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white">
                  POST {{ webhookUrl }}
                </code>
                <button
                  type="button"
                  class="p-2 rounded-lg border shrink-0 hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
                  @click="copyUrl"
                >
                  <component :is="ICONS.Copy" :size="12" weight="Linear" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Headers</label>
              <div class="flex items-start gap-1.5">
                <code class="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] font-mono leading-relaxed whitespace-pre border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white">X-Workspace-Slug: {{ auth.orgSlug }}
X-Device-Report-Secret: {{ store.status.secret }}</code>
                <Button size="sm" variant="ghost" @click="copyHeaders">Copy</Button>
              </div>
            </div>
            <div>
              <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Example JSON body</label>
              <code class="block px-2.5 py-2 rounded-lg text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white">{{ exampleJsonBody }}</code>
            </div>
            <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
              <template v-if="store.status.rotatedBy">Last generated by {{ store.status.rotatedBy }}. </template>
              Known key names (e.g. BitLockerStatus / FileVaultEnabled) are normalized to shared names so one policy condition covers both platforms —
              anything else passes through as-is under "attributes".
            </p>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <Button v-if="store.status.configured" variant="ghost" :loading="busy" @click="clear">Remove</Button>
            <Button variant="secondary" :loading="busy" @click="rotate">{{ store.status.configured ? "Rotate secret" : "Generate webhook secret" }}</Button>
          </div>
        </template>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Applivery SOAR Agent</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          The dedicated native agent (Windows Service / macOS LaunchDaemon) that supersedes the App Inventory and Security
          Attestation scripts below — one persistent, scheduled process instead of two cron/Task Scheduler jobs. Binaries are
          built and published as GitHub Releases from their own repos; configure a read-scoped GitHub token here to list and
          download them. The workspace secret is never baked into the binary — it's delivered separately via the Managed
          Configuration snippet, pushed by your UEM/MDM or installed by hand.
        </p>
        <Alert v-if="agentStore.error" type="danger">{{ agentStore.error }}</Alert>
        <Alert v-if="tokenSaved" type="success">GitHub token saved.</Alert>
        <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>

        <p v-if="!agentStore.config" class="text-xs text-gray-500 dark:text-gray-400">Checking status…</p>
        <template v-else>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full shrink-0" :class="agentStore.config.configured ? 'bg-emerald-500' : 'bg-amber-500'" />
            <span class="text-xs font-semibold text-gray-900 dark:text-white">
              <template v-if="agentStore.config.configured">GitHub token configured ({{ agentStore.config.tokenMasked }})</template>
              <template v-else>No GitHub token configured yet</template>
            </span>
          </div>
          <p v-if="agentStore.config.configuredBy" class="text-[10px] text-gray-500 dark:text-gray-400">
            Set by {{ agentStore.config.configuredBy }} on {{ new Date(agentStore.config.configuredAt!).toLocaleString() }}
          </p>

          <div class="flex items-center gap-2">
            <Input
              v-model="githubTokenInput"
              type="password"
              :placeholder="agentStore.config.configured ? 'New token — leave blank to keep current' : 'GitHub personal access token (repo read scope)'"
              :disabled="!canEdit()"
              class="flex-1"
            />
            <Button size="sm" :loading="tokenBusy" :disabled="!canEdit() || !githubTokenInput.trim()" @click="saveGithubToken">
              {{ agentStore.config.configured ? "Rotate" : "Save" }}
            </Button>
            <Button v-if="agentStore.config.configured" size="sm" variant="ghost" :loading="tokenBusy" :disabled="!canEdit()" @click="clearGithubToken">Remove</Button>
          </div>

          <template v-if="agentStore.config.configured">
            <div class="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
              <div class="flex items-center justify-between">
                <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400">Downloads (latest release)</p>
                <Button size="sm" variant="ghost" :loading="agentStore.isLoadingAssets" @click="agentStore.fetchAssets()">Refresh</Button>
              </div>
              <Alert v-if="agentStore.assetsError" type="danger">{{ agentStore.assetsError }}</Alert>
              <p v-if="!agentStore.isLoadingAssets && agentStore.assets.length === 0" class="text-xs text-gray-500 dark:text-gray-400">
                No release assets yet — the agent repos publish one automatically on push to main.
              </p>
              <div v-for="asset in agentStore.assets" :key="`${asset.platform}-${asset.assetId}`" class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <div class="min-w-0">
                  <p class="text-xs font-mono truncate text-gray-900 dark:text-white">{{ asset.filename }}</p>
                  <p class="text-[10px] text-gray-500 dark:text-gray-400">
                    {{ platformLabels[asset.platform] }} · {{ formatBytes(asset.sizeBytes) }} · {{ new Date(asset.publishedAt).toLocaleDateString() }}
                  </p>
                </div>
                <button
                  type="button"
                  :disabled="downloadingAsset === asset.assetId"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
                  @click="downloadAgentAsset(asset)"
                >
                  <component :is="ICONS.Download" :size="12" weight="Linear" /> {{ downloadingAsset === asset.assetId ? "Preparing…" : "Download" }}
                </button>
              </div>
            </div>

            <div v-if="store.status?.configured" class="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
              <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400">Managed Configuration</p>
              <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                Push this with your webhook URL, workspace, and secret already filled in. Windows: import the .reg file (or push the
                same values via your UEM to <span class="font-mono">HKLM\SOFTWARE\Policies\Applivery\SOAR</span>). macOS: deploy as
                <span class="font-mono">/Library/Preferences/es.mi-labs.soar.agent.json</span> via MDM Custom Settings.
              </p>
              <div class="grid grid-cols-2 gap-2">
                <div class="flex gap-1.5">
                  <Button size="sm" variant="ghost" class="flex-1" @click="downloadSnippet('windows')">Windows .reg</Button>
                  <Button size="sm" variant="ghost" @click="copySnippet('windows')">Copy</Button>
                </div>
                <div class="flex gap-1.5">
                  <Button size="sm" variant="ghost" class="flex-1" @click="downloadSnippet('macos')">macOS .json</Button>
                  <Button size="sm" variant="ghost" @click="copySnippet('macos')">Copy</Button>
                </div>
              </div>
            </div>
            <p v-else class="text-xs text-gray-500 dark:text-gray-400">Generate a webhook secret above first — the Managed Configuration snippet reuses it.</p>
          </template>
        </template>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">App Inventory Reporting</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          A stopgap for App List compliance (Missing/Disallowed app conditions) before the dedicated Applivery SOAR agent exists. These scripts read each
          device's installed apps and versions locally — real bundle IDs + CFBundleShortVersionString on macOS, winget package IDs + Version on Windows
          when available — and push them to the same secret used above, straight into the app-inventory store. Version data also feeds the Vulnerability
          Service integration's per-app CVE matching (Settings &gt; Vulnerability Service) — for Windows in particular, this self-report path is the more
          reliable source of app versions today, since Applivery's own MDM API doesn't document a stable schema for per-device Windows app versions yet. A
          self-reporting device effectively refreshes itself for free: the background refresher skips it and spends its budget on devices that can't
          self-report yet.
        </p>
        <p v-if="!store.status?.configured" class="text-xs text-gray-500 dark:text-gray-400">Generate a webhook secret above first — these scripts reuse it.</p>
        <template v-else>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              :disabled="downloading === 'macos'"
              class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
              @click="download('apps', 'macos')"
            >
              <component :is="ICONS.Download" :size="13" weight="Linear" /> {{ downloading === "macos" ? "Preparing…" : "macOS script (.sh)" }}
            </button>
            <button
              type="button"
              :disabled="downloading === 'windows'"
              class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
              @click="download('apps', 'windows')"
            >
              <component :is="ICONS.Download" :size="13" weight="Linear" /> {{ downloading === "windows" ? "Preparing…" : "Windows script (.ps1)" }}
            </button>
          </div>
          <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
            Downloaded with your webhook URL, workspace, and secret already filled in — nothing to edit. Schedule the macOS script with launchd
            (LaunchAgent/LaunchDaemon) and the Windows script with Task Scheduler running as SYSTEM; both include a ready-to-use setup snippet in their
            header comments. Every app-list-scoped device that runs one of these stops drawing from the background refresher's API budget.
          </p>
        </template>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Security Attestation Reporting (Windows &amp; macOS)</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          Reports hardware/OS security posture straight off the device — Secure Boot, Virtualization-Based Security, Credential Guard, memory integrity
          (HVCI), BitLocker, and TPM readiness on Windows; FileVault, firewall, XProtect, Secure Token, and screen lock on macOS — without depending on
          Applivery having a confirmed passthrough for reading that level of detail back through its MDM channel. Feeds the "Self-Reported Attribute"
          condition type in Compliance Policies, so a policy can flag a device Non-Compliant the moment one of these drops and trigger the matching
          enforcement action automatically. No Android/iOS equivalent — neither platform lets a third party run an unattended script with local admin/root
          privileges; that would need a dedicated MDM agent app instead.
        </p>
        <p v-if="!store.status?.configured" class="text-xs text-gray-500 dark:text-gray-400">Generate a webhook secret above first — these scripts reuse it.</p>
        <template v-else>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              :disabled="downloadingSecurity === 'windows'"
              class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
              @click="download('security', 'windows')"
            >
              <component :is="ICONS.Download" :size="13" weight="Linear" /> {{ downloadingSecurity === "windows" ? "Preparing…" : "Windows script (.ps1)" }}
            </button>
            <button
              type="button"
              :disabled="downloadingSecurity === 'macos'"
              class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
              @click="download('security', 'macos')"
            >
              <component :is="ICONS.Download" :size="13" weight="Linear" /> {{ downloadingSecurity === "macos" ? "Preparing…" : "macOS script (.sh)" }}
            </button>
          </div>
          <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
            Windows: run as SYSTEM (Task Scheduler) — several queries need elevated context to return complete data. macOS: run as a LaunchDaemon (root) —
            Secure Token/screen lock are per-user settings the script reads via the current console user, so a machine with no one logged in reports those
            as unknown rather than guessed. Setup snippets included in each script's header comments.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
