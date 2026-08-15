<script setup lang="ts">
// Device Data Webhook tab — now the single place to get a fully-configured
// native agent onto a device: download/publish the agent binary, pick what
// it reports, and download one combined Managed Configuration bundle
// (Windows .reg/.ps1, macOS .json/.sh) that includes the device-report
// secret plus — automatically, once generated in mTLS Agent Authentication
// — the workspace's Global Bootstrap Token. Deliberately does NOT surface
// the raw webhook URL/headers/example-JSON (that's for an arbitrary
// third-party script hitting the endpoint directly, not this agent) or the
// old standalone App Inventory/Security Attestation cron-script downloads
// (separate scheduled-script mechanisms that run outside the agent and
// outside Managed Configuration entirely) — everything on this page is
// either the agent binary itself or a value that lands in its Managed
// Configuration.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { copyToClipboard } from "../../lib/clipboard";
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useDeviceReportSecretStore } from "../../stores/deviceReportSecret";
import { useMtlsStore } from "../../stores/mtls";
import { AGENT_VARIANTS, useAgentDownloadsStore, variantKey, type AgentAsset, type AgentVariant } from "../../stores/agentDownloads";

const emit = defineEmits<{ goToTab: [id: string] }>();

const store = useDeviceReportSecretStore();
const mtls = useMtlsStore();
const auth = useAuthStore();
const agentStore = useAgentDownloadsStore();
const busy = ref(false);

const canEdit = () => auth.hasRiskyAction("canEditIntegrationSecrets");
const githubTokenInput = ref("");
const tokenBusy = ref(false);
const tokenSaved = ref(false);
const downloadingAsset = ref<number | null>(null);

async function rotate() {
  busy.value = true;
  try { await store.rotate(); } finally { busy.value = false; }
}
async function clear() {
  busy.value = true;
  try { await store.clear(); } finally { busy.value = false; }
}

// ── What this agent reports ──
const includeAppInventory = ref(true);
const includeSecurityAttestation = ref(true);

const REPORT_INTERVAL_MIN_MINUTES = 1;
const REPORT_INTERVAL_MAX_MINUTES = 1440;
const REPORT_INTERVAL_WARN_BELOW_MINUTES = 5;
const reportIntervalMinutes = ref(60);
const reportIntervalSeconds = computed(() => {
  const clamped = Math.min(REPORT_INTERVAL_MAX_MINUTES, Math.max(REPORT_INTERVAL_MIN_MINUTES, Number(reportIntervalMinutes.value) || 60));
  return Math.round(clamped * 60);
});
const reportIntervalWarning = computed(() => reportIntervalMinutes.value > 0 && reportIntervalMinutes.value < REPORT_INTERVAL_WARN_BELOW_MINUTES);

// ── mTLS bootstrap token (Windows only — see note in template) ──
// Automatically included in the Windows snippet the moment it's configured
// in mTLS Agent Authentication — no separate opt-in checkbox here, since a
// device that already has an active certificate can never be silently
// re-registered, so including it is never harmful even for an
// already-enrolled device.
const bootstrapTokenAvailable = computed(() => Boolean(mtls.bootstrapTokenStatus?.configured));

function boolToRegDword(value: boolean): string {
  return `dword:${value ? "00000001" : "00000000"}`;
}

const windowsRegSnippet = computed(() => {
  const reportSecret = store.status?.secret ?? "";
  const lines = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Applivery\\SOAR]`,
    `"BaseURL"="${window.location.origin}"`,
    `"WorkspaceSlug"="${auth.orgSlug}"`,
    `"ReportSecret"="${reportSecret}"`,
    `"ReportBitLocker"=${boolToRegDword(includeSecurityAttestation.value)}`,
    `"ReportFirewall"=${boolToRegDword(includeSecurityAttestation.value)}`,
    `"ReportApps"=${boolToRegDword(includeAppInventory.value)}`,
    `"IntervalSec"=dword:${reportIntervalSeconds.value.toString(16).padStart(8, "0")}`,
  ];
  if (bootstrapTokenAvailable.value) {
    lines.push(`"BootstrapToken"="${mtls.bootstrapTokenStatus?.secret ?? ""}"`);
  }
  return lines.join("\n") + "\n";
});
const macosConfigSnippet = computed(() =>
  JSON.stringify(
    {
      base_url: window.location.origin,
      workspace_slug: auth.orgSlug,
      report_secret: store.status?.secret ?? "",
      interval_sec: reportIntervalSeconds.value,
      report_bitlocker: includeSecurityAttestation.value,
      report_firewall: includeSecurityAttestation.value,
      report_apps: includeAppInventory.value,
    },
    null,
    2,
  ),
);
// Applivery-native counterparts to the .reg/.json snippets above — instead
// of a manually-imported file, these are ready to paste into Applivery
// Dashboard > Resources > Scripts > Create Script, then assign to the
// Policy covering the fleet (Scope: Machine, Execution: Once). Deploys to
// every enrolled device at next sync — no per-device manual step.
const windowsScriptSnippet = computed(() => {
  const reportSecret = store.status?.secret ?? "";
  const lines = [
    `# Applivery SOAR Agent — Managed Configuration (PowerShell)`,
    `# Deploy: Applivery Dashboard > Resources > Scripts > Create Script (language: PowerShell),`,
    `# paste this, then assign it to the Policy covering this fleet — Scope: Machine, Execution: Once.`,
    `$ErrorActionPreference = "Stop"`,
    `$regPath = "HKLM:\\SOFTWARE\\Policies\\Applivery\\SOAR"`,
    `New-Item -Path $regPath -Force | Out-Null`,
    `Set-ItemProperty -Path $regPath -Name "BaseURL" -Value "${window.location.origin}" -Type String`,
    `Set-ItemProperty -Path $regPath -Name "WorkspaceSlug" -Value "${auth.orgSlug}" -Type String`,
    `Set-ItemProperty -Path $regPath -Name "ReportSecret" -Value "${reportSecret}" -Type String`,
    `Set-ItemProperty -Path $regPath -Name "ReportBitLocker" -Value ${includeSecurityAttestation.value ? 1 : 0} -Type DWord`,
    `Set-ItemProperty -Path $regPath -Name "ReportFirewall" -Value ${includeSecurityAttestation.value ? 1 : 0} -Type DWord`,
    `Set-ItemProperty -Path $regPath -Name "ReportApps" -Value ${includeAppInventory.value ? 1 : 0} -Type DWord`,
    `Set-ItemProperty -Path $regPath -Name "IntervalSec" -Value ${reportIntervalSeconds.value} -Type DWord`,
  ];
  if (bootstrapTokenAvailable.value) {
    lines.push(`Set-ItemProperty -Path $regPath -Name "BootstrapToken" -Value "${mtls.bootstrapTokenStatus?.secret ?? ""}" -Type String`);
  }
  lines.push(`Write-Host "Applivery SOAR Agent managed configuration applied."`);
  return lines.join("\n") + "\n";
});
const macosScriptSnippet = computed(
  () => `#!/bin/bash
# Applivery SOAR Agent — Managed Configuration (shell)
# Deploy: Applivery Dashboard > Resources > Scripts > Create Script (language: Shell/Bash),
# paste this, then assign it to the Policy covering this fleet — Scope: Machine, Execution: Once.
set -e
mkdir -p /Library/Preferences
cat > /Library/Preferences/es.mi-labs.soar.agent.json <<'SOAR_EOF'
${macosConfigSnippet.value}
SOAR_EOF
chmod 644 /Library/Preferences/es.mi-labs.soar.agent.json
echo "Applivery SOAR Agent managed configuration applied."
`,
);

type SnippetKind = "windows-reg" | "windows-script" | "macos-json" | "macos-script";
const SNIPPET_FILENAMES: Record<SnippetKind, string> = {
  "windows-reg": "applivery-soar-agent.reg",
  "windows-script": "applivery-soar-agent-managed-config.ps1",
  "macos-json": "es.mi-labs.soar.agent.json",
  "macos-script": "applivery-soar-agent-managed-config.sh",
};
function snippetContent(kind: SnippetKind): string {
  if (kind === "windows-reg") return windowsRegSnippet.value;
  if (kind === "windows-script") return windowsScriptSnippet.value;
  if (kind === "macos-json") return macosConfigSnippet.value;
  return macosScriptSnippet.value;
}
function downloadSnippet(kind: SnippetKind) {
  const blob = new Blob([snippetContent(kind)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = SNIPPET_FILENAMES[kind];
  a.click();
  URL.revokeObjectURL(url);
}
const copiedKind = ref<SnippetKind | null>(null);
async function copySnippet(kind: SnippetKind) {
  const ok = await copyToClipboard(snippetContent(kind));
  if (ok) {
    copiedKind.value = kind;
    setTimeout(() => {
      if (copiedKind.value === kind) copiedKind.value = null;
    }, 2000);
  } else {
    alert("Couldn't copy automatically — this usually happens when the dashboard is loaded over plain HTTP instead of HTTPS. Select the text above and copy it manually (Ctrl/Cmd+C).");
  }
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
async function publishAgent(variant: AgentVariant) {
  try {
    await agentStore.publishToApplivery(variant);
  } catch {
    // Surfaced via agentStore.publishError in the template — nothing else to do here.
  }
}
function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
// Only used by the legacy GitHub-token release list below (AgentAsset is
// still plain platform-keyed, not (platform, arch) like AGENT_VARIANTS —
// that path never carried an ARM64 build to begin with).
const platformLabels: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
};

onMounted(async () => {
  await store.fetchStatus();
  await mtls.fetchBootstrapTokenStatus();
  await agentStore.fetchBuildMeta();
  await agentStore.fetchPublishStatus();
  await agentStore.fetchConfig();
  await agentStore.fetchAssets();
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Applivery SOAR Agent</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          The dedicated native agent (Windows Service / macOS LaunchDaemon) — one persistent, scheduled process. Every
          build is downloadable below with no token or login required, same as pulling a public Docker image. No
          workspace-specific data is ever baked into the binary — it's delivered separately via the Managed
          Configuration bundle further down, pushed by your UEM/MDM or installed by hand.
        </p>
        <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — publishing to Applivery is disabled.</Alert>
        <Alert v-if="agentStore.buildsError" type="danger">{{ agentStore.buildsError }}</Alert>

        <div v-if="agentStore.isLoadingBuilds" class="text-xs text-gray-500 dark:text-gray-400">Checking for published builds…</div>
        <div v-else class="space-y-2">
          <div
            v-for="variant in AGENT_VARIANTS"
            :key="variantKey(variant.platform, variant.arch)"
            class="px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-1.5"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-bold text-gray-900 dark:text-white">{{ variant.label }}</p>
                <template v-if="agentStore.builds[variantKey(variant.platform, variant.arch)]">
                  <p class="text-[10px] font-mono truncate text-gray-500 dark:text-gray-400">{{ agentStore.builds[variantKey(variant.platform, variant.arch)]!.filename }} · {{ formatBytes(agentStore.builds[variantKey(variant.platform, variant.arch)]!.sizeBytes) }}</p>
                  <p v-if="agentStore.publishStatus?.[variantKey(variant.platform, variant.arch)]?.applicationId" class="text-[10px] text-emerald-600 dark:text-emerald-400">
                    Published to Applivery {{ agentStore.publishStatus![variantKey(variant.platform, variant.arch)].publishedAt ? `on ${new Date(agentStore.publishStatus![variantKey(variant.platform, variant.arch)].publishedAt!).toLocaleDateString()}` : "" }}
                  </p>
                </template>
                <p v-else class="text-[10px] text-gray-500 dark:text-gray-400">No build published yet — the agent repo's CI publishes one automatically on push to main.</p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="ghost" :disabled="!agentStore.builds[variantKey(variant.platform, variant.arch)]" :loading="agentStore.downloadingBuild === variantKey(variant.platform, variant.arch)" @click="agentStore.downloadBuild(variant)">Download</Button>
                <Button
                  size="sm"
                  :disabled="!agentStore.builds[variantKey(variant.platform, variant.arch)] || !canEdit()"
                  :loading="agentStore.isPublishing === variantKey(variant.platform, variant.arch)"
                  @click="publishAgent(variant)"
                >
                  {{ agentStore.publishStatus?.[variantKey(variant.platform, variant.arch)]?.applicationId ? "Republish" : "Publish to Applivery" }}
                </Button>
              </div>
            </div>
            <Alert v-if="agentStore.publishErrors[variantKey(variant.platform, variant.arch)]" type="danger">{{ agentStore.publishErrors[variantKey(variant.platform, variant.arch)] }}</Alert>
            <Alert v-if="agentStore.publishInfos[variantKey(variant.platform, variant.arch)]" type="info">{{ agentStore.publishInfos[variantKey(variant.platform, variant.arch)] }}</Alert>
          </div>
        </div>

        <details class="pt-2">
          <summary class="cursor-pointer text-[10px] font-medium text-gray-500 dark:text-gray-400 select-none">Advanced: download via GitHub token instead (optional)</summary>
          <div class="pt-3 space-y-3">
            <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              An older, still-supported path that proxies the agent repos' own GitHub Releases directly — only useful if you'd rather not rely on this
              app's own build mirror above. Requires a read-scoped GitHub token most customers won't have.
            </p>
            <Alert v-if="agentStore.error" type="danger">{{ agentStore.error }}</Alert>
            <Alert v-if="tokenSaved" type="success">GitHub token saved.</Alert>

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
              </template>
            </template>
          </div>
        </details>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Device Report Secret</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          The baseline credential every device needs — included in the Managed Configuration bundle below. Stays the
          fallback/interim auth path even once mTLS is set up (a device without an active certificate yet still needs
          it to report).
        </p>
        <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
        <p v-if="!store.status" class="text-xs text-gray-500 dark:text-gray-400">Checking status…</p>
        <template v-else>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full shrink-0" :class="store.status.configured ? 'bg-emerald-500' : 'bg-amber-500'" />
            <span class="text-xs font-semibold text-gray-900 dark:text-white">
              <template v-if="store.status.configured">Secret configured for <span class="font-mono">{{ auth.orgSlug }}</span></template>
              <template v-else>Not configured for this workspace</template>
            </span>
          </div>
          <p v-if="store.status.rotatedBy" class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">Last generated by {{ store.status.rotatedBy }}.</p>
          <div class="flex justify-end gap-2 pt-1">
            <Button v-if="store.status.configured" variant="ghost" :loading="busy" @click="clear">Remove</Button>
            <Button variant="secondary" :loading="busy" @click="rotate">{{ store.status.configured ? "Rotate secret" : "Generate secret" }}</Button>
          </div>
        </template>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">What This Agent Reports</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <label class="flex items-start gap-2 text-xs text-gray-900 dark:text-white">
          <input type="checkbox" v-model="includeAppInventory" class="mt-0.5" />
          <span>
            <span class="font-semibold">App Inventory Reporting</span>
            <span class="block text-[10px] text-gray-500 dark:text-gray-400">Installed apps + versions — feeds App List compliance and Vulnerability Service CVE matching.</span>
          </span>
        </label>
        <label class="flex items-start gap-2 text-xs text-gray-900 dark:text-white">
          <input type="checkbox" v-model="includeSecurityAttestation" class="mt-0.5" />
          <span>
            <span class="font-semibold">Security Attestation Reporting</span>
            <span class="block text-[10px] text-gray-500 dark:text-gray-400">BitLocker/FileVault + firewall posture — feeds Self-Reported Attribute compliance conditions.</span>
          </span>
        </label>

        <div class="pt-2 border-t border-gray-100 dark:border-gray-800">
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Report interval</label>
          <div class="flex items-center gap-2">
            <Input v-model.number="reportIntervalMinutes" type="number" min="1" max="1440" class="w-28" />
            <span class="text-[11px] text-gray-500 dark:text-gray-400">minutes</span>
          </div>
          <p class="text-[10px] mt-1 leading-relaxed text-gray-400">
            Takes effect on the device's next service restart or reboot after the new Managed Configuration lands —
            it isn't picked up mid-cycle. Values under 30 seconds are ignored by the agent and fall back to its own
            built-in 1-hour default.
          </p>
          <Alert v-if="reportIntervalWarning" type="warning" class="mt-1.5">
            Under {{ REPORT_INTERVAL_WARN_BELOW_MINUTES }} minutes generates significant extra load fleet-wide. Fine
            for a small pilot; for production, pair a short interval with per-device "Force report" instead of
            lowering the default for everyone.
          </Alert>
        </div>

        <p v-if="bootstrapTokenAvailable" class="text-[10px] leading-relaxed text-emerald-600 dark:text-emerald-400">
          A Global Bootstrap Token is configured — it's included automatically in the Windows bundle below, so this
          device will also register for its own mTLS client certificate. macOS has no mTLS support yet, so the macOS
          bundle never includes it.
        </p>
        <p v-else class="text-[10px] leading-relaxed text-gray-400">
          No Global Bootstrap Token configured yet — this bundle will only include the device report secret above.
          Generate one in <button type="button" class="underline decoration-dotted" @click="emit('goToTab', 'mtls')">mTLS Agent Authentication</button> to also enroll devices for client certificates.
        </p>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Download Managed Configuration</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p v-if="!store.status?.configured" class="text-xs text-gray-500 dark:text-gray-400">Generate the device report secret above first — the bundle reuses it.</p>
        <template v-else>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div class="flex gap-1.5">
              <Button size="sm" variant="ghost" class="flex-1" @click="downloadSnippet('windows-script')">Windows Script (.ps1)</Button>
              <Button size="sm" variant="ghost" @click="copySnippet('windows-script')">
                <component v-if="copiedKind === 'windows-script'" :is="ICONS.CheckCircle" :size="12" weight="Linear" style="color: #10b981" />
                <template v-else>Copy</template>
              </Button>
            </div>
            <div class="flex gap-1.5">
              <Button size="sm" variant="ghost" class="flex-1" @click="downloadSnippet('macos-script')">macOS Script (.sh)</Button>
              <Button size="sm" variant="ghost" @click="copySnippet('macos-script')">
                <component v-if="copiedKind === 'macos-script'" :is="ICONS.CheckCircle" :size="12" weight="Linear" style="color: #10b981" />
                <template v-else>Copy</template>
              </Button>
            </div>
            <div class="flex gap-1.5">
              <Button size="sm" variant="ghost" class="flex-1" @click="downloadSnippet('windows-reg')">Windows .reg</Button>
              <Button size="sm" variant="ghost" @click="copySnippet('windows-reg')">
                <component v-if="copiedKind === 'windows-reg'" :is="ICONS.CheckCircle" :size="12" weight="Linear" style="color: #10b981" />
                <template v-else>Copy</template>
              </Button>
            </div>
            <div class="flex gap-1.5">
              <Button size="sm" variant="ghost" class="flex-1" @click="downloadSnippet('macos-json')">macOS .json</Button>
              <Button size="sm" variant="ghost" @click="copySnippet('macos-json')">
                <component v-if="copiedKind === 'macos-json'" :is="ICONS.CheckCircle" :size="12" weight="Linear" style="color: #10b981" />
                <template v-else>Copy</template>
              </Button>
            </div>
          </div>
          <p class="text-[10px] leading-relaxed text-gray-400">
            Script variants (recommended): paste into Applivery Dashboard &gt; Resources &gt; Scripts &gt; Create Script, assign to the Policy
            covering this fleet (Scope: Machine, Execution: Once) — lands on every enrolled device at next sync, no manual per-device step. The
            .reg / .json variants are for manual import or a UEM Custom Settings/OMA-URI push instead.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
