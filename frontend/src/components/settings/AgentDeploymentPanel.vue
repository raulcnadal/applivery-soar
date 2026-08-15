<script setup lang="ts">
// "Agent Deployment" tab — the single Managed Configuration generator for
// the native Windows/macOS agent, combining what used to require visiting
// both Device Data Webhook (base ReportSecret + reporting toggles) and mTLS
// Agent Authentication (EnrollmentSecret) separately to assemble one working
// registry/plist push. This panel doesn't own the underlying secrets or the
// CA/mode lifecycle — those stay in their existing panels (device-webhook /
// mtls) as the source of truth — it only reads that state and lets an admin
// pick which reporting features + identity method go into one combined
// download, computed client-side same as the two panels it consolidates.
//
// mTLS is Windows-only today (see mtls_windows.go / registry_windows.go's
// EnrollmentSecret field) — the macOS agent (config.go) has no equivalent
// field yet, so the mTLS checkbox below only ever affects the Windows
// snippets; the macOS ones stay legacy-ReportSecret-only regardless.
import { computed, onMounted, ref } from "vue";
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { copyToClipboard } from "../../lib/clipboard";
import { useAuthStore } from "../../stores/auth";
import { useDeviceReportSecretStore } from "../../stores/deviceReportSecret";
import { useMtlsStore } from "../../stores/mtls";

const emit = defineEmits<{ goToTab: [id: string] }>();

const auth = useAuthStore();
const reportStore = useDeviceReportSecretStore();
const mtls = useMtlsStore();

const canEditSecrets = () => auth.hasRiskyAction("canEditIntegrationSecrets");

const reportSecretBusy = ref(false);
async function generateReportSecret() {
  reportSecretBusy.value = true;
  try {
    await reportStore.rotate();
  } finally {
    reportSecretBusy.value = false;
  }
}

function goTo(tab: string) {
  emit("goToTab", tab);
}

// ── What gets reported ──
const includeAppInventory = ref(true);
const includeSecurityAttestation = ref(true);

// Same clamp/warning behavior as DeviceDataWebhookPanel's own interval
// field — kept in sync deliberately, this replaces that one for anyone who
// switches to using this panel as their one stop.
const REPORT_INTERVAL_MIN_MINUTES = 1;
const REPORT_INTERVAL_MAX_MINUTES = 1440;
const REPORT_INTERVAL_WARN_BELOW_MINUTES = 5;
const reportIntervalMinutes = ref(60);
const reportIntervalSeconds = computed(() => {
  const clamped = Math.min(REPORT_INTERVAL_MAX_MINUTES, Math.max(REPORT_INTERVAL_MIN_MINUTES, Number(reportIntervalMinutes.value) || 60));
  return Math.round(clamped * 60);
});
const reportIntervalWarning = computed(() => reportIntervalMinutes.value > 0 && reportIntervalMinutes.value < REPORT_INTERVAL_WARN_BELOW_MINUTES);

// ── Identity method ──
// ReportSecret is always included when it exists — it's the baseline every
// device needs (either as its only auth, pre-enforcement, or as the request
// path devices without an active certificate yet still need for reporting
// while an mTLS enrollment request is pending approval). EnrollmentSecret is
// additive and Windows-only, offered only once a workspace has actually
// configured it.
const enrollmentEligible = computed(() => Boolean(mtls.enrollmentSecretStatus?.configured));
const includeMtlsEnrollment = ref(true);
const selfServiceModeIsDisabled = computed(() => mtls.selfServiceMode === "disabled");

const ready = computed(() => Boolean(reportStore.status?.configured));

function secondsToRegDword(seconds: number): string {
  return `dword:${Math.max(0, Math.round(seconds)).toString(16).padStart(8, "0")}`;
}
function boolToRegDword(value: boolean): string {
  return `dword:${value ? "00000001" : "00000000"}`;
}

const windowsRegSnippet = computed(() => {
  const reportSecret = reportStore.status?.secret ?? "";
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
    `"IntervalSec"=${secondsToRegDword(reportIntervalSeconds.value)}`,
  ];
  if (enrollmentEligible.value && includeMtlsEnrollment.value) {
    lines.push(`"EnrollmentSecret"="${mtls.enrollmentSecretStatus?.secret ?? ""}"`);
  }
  return lines.join("\n") + "\n";
});

const windowsScriptSnippet = computed(() => {
  const reportSecret = reportStore.status?.secret ?? "";
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
  if (enrollmentEligible.value && includeMtlsEnrollment.value) {
    lines.push(`Set-ItemProperty -Path $regPath -Name "EnrollmentSecret" -Value "${mtls.enrollmentSecretStatus?.secret ?? ""}" -Type String`);
  }
  lines.push(`Write-Host "Applivery SOAR Agent managed configuration applied."`);
  return lines.join("\n") + "\n";
});

const macosConfigSnippet = computed(() =>
  JSON.stringify(
    {
      base_url: window.location.origin,
      workspace_slug: auth.orgSlug,
      report_secret: reportStore.status?.secret ?? "",
      interval_sec: reportIntervalSeconds.value,
      report_bitlocker: includeSecurityAttestation.value,
      report_firewall: includeSecurityAttestation.value,
      report_apps: includeAppInventory.value,
    },
    null,
    2,
  ),
);
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
  "windows-reg": "applivery-soar-agent-deployment.reg",
  "windows-script": "applivery-soar-agent-deployment.ps1",
  "macos-json": "es.mi-labs.soar.agent.json",
  "macos-script": "applivery-soar-agent-deployment.sh",
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

onMounted(async () => {
  await reportStore.fetchStatus();
  await mtls.fetchCaStatus();
  await mtls.fetchEnrollmentSecretStatus();
  await mtls.fetchSelfServiceMode();
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Agent Deployment</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          One Managed Configuration bundle for the whole fleet — pick what this agent should report and how it should authenticate, then push the
          result via your UEM (or a manual registry import / plist for a pilot device). This replaces assembling the reporting secret from
          <button type="button" class="underline decoration-dotted" @click="goTo('device-webhook')">Device Data Webhook</button> and the identity
          secret from <button type="button" class="underline decoration-dotted" @click="goTo('mtls')">mTLS Agent Authentication</button> by hand —
          both are still there if you want to manage the underlying secrets, CA, or approval queue directly.
        </p>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">1. Prerequisites</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <Alert v-if="reportStore.error" type="danger">{{ reportStore.error }}</Alert>

        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-2 h-2 rounded-full shrink-0" :class="reportStore.status?.configured ? 'bg-emerald-500' : 'bg-amber-500'" />
            <span class="text-xs text-gray-900 dark:text-white">
              <span class="font-semibold">Device report secret</span> — required baseline, every device needs this
              <template v-if="!reportStore.status?.configured"> (not generated yet)</template>
            </span>
          </div>
          <Button size="sm" variant="secondary" :disabled="!canEditSecrets()" :loading="reportSecretBusy" @click="generateReportSecret">
            {{ reportStore.status?.configured ? "Rotate" : "Generate" }}
          </Button>
        </div>

        <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-2 h-2 rounded-full shrink-0" :class="mtls.caStatus?.configured ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'" />
            <span class="text-xs text-gray-900 dark:text-white">
              <span class="font-semibold">mTLS Certificate Authority</span> — optional, Windows only
              <template v-if="!mtls.caStatus?.configured"> (not configured)</template>
            </span>
          </div>
          <Button v-if="!mtls.caStatus?.configured" size="sm" variant="ghost" @click="goTo('mtls')">Set up</Button>
        </div>

        <div v-if="mtls.caStatus?.configured" class="flex items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-2 h-2 rounded-full shrink-0" :class="enrollmentEligible ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'" />
            <span class="text-xs text-gray-900 dark:text-white">
              <span class="font-semibold">Self-service enrollment secret</span>
              <template v-if="enrollmentEligible">
                — mode: <span class="font-mono">{{ mtls.selfServiceMode }}</span>
              </template>
              <template v-else> (not generated)</template>
            </span>
          </div>
          <Button size="sm" variant="ghost" @click="goTo('mtls')">Manage</Button>
        </div>
        <Alert v-if="mtls.caStatus?.configured && enrollmentEligible && selfServiceModeIsDisabled" type="warning">
          The enrollment secret exists but self-service mode is still "disabled" — devices presenting it can't actually enroll yet. Pick Silent or
          Approval in mTLS Agent Authentication before relying on this.
        </Alert>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">2. What this agent reports</h3>
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
            <span class="block text-[10px] text-gray-500 dark:text-gray-400">
              BitLocker/FileVault, firewall, Secure Boot/VBS posture — feeds Self-Reported Attribute compliance conditions.
            </span>
          </span>
        </label>
        <label class="flex items-start gap-2 text-xs" :class="enrollmentEligible ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-600'">
          <input type="checkbox" v-model="includeMtlsEnrollment" :disabled="!enrollmentEligible" class="mt-0.5" />
          <span>
            <span class="font-semibold">mTLS Certificate Enrollment (Windows only)</span>
            <span class="block text-[10px] text-gray-500 dark:text-gray-400">
              <template v-if="enrollmentEligible">Device presents the shared enrollment secret to get its own client certificate. Ignored in the macOS bundle — no macOS agent support yet.</template>
              <template v-else>Generate an enrollment secret in mTLS Agent Authentication to enable this.</template>
            </span>
          </span>
        </label>

        <div class="pt-2 border-t border-gray-100 dark:border-gray-800">
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Report interval</label>
          <div class="flex items-center gap-2">
            <Input v-model.number="reportIntervalMinutes" type="number" min="1" max="1440" class="w-28" />
            <span class="text-[11px] text-gray-500 dark:text-gray-400">minutes</span>
          </div>
          <Alert v-if="reportIntervalWarning" type="warning" class="mt-1.5">
            Under {{ REPORT_INTERVAL_WARN_BELOW_MINUTES }} minutes generates significant extra load fleet-wide. Fine for a small pilot; for
            production, pair a short interval with per-device "Force report" instead of lowering the default for everyone.
          </Alert>
        </div>

        <p class="text-[10px] leading-relaxed text-gray-400">
          Per-device bootstrap tokens aren't part of this bundle — they're inherently one-per-device and can't be pushed via a single fleet-wide
          profile. Use the enrollment secret above for zero-touch fleet deployment, or mint individual bootstrap tokens from
          <button type="button" class="underline decoration-dotted" @click="goTo('mtls')">mTLS Agent Authentication</button> for one-off devices.
        </p>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">3. Download</h3>
      <div class="p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 max-w-2xl shadow-sm">
        <p v-if="!ready" class="text-xs text-gray-500 dark:text-gray-400">Generate the device report secret above first.</p>
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
