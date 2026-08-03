<script setup lang="ts">
// Backup & Restore tab. Port of App.jsx:5951-6031 — two independent systems:
// (1) "Dashboard layout only" (exportDashboard/importDashboard, App.jsx:
// 3492-3540) — widgets/webhookUrl/smtpConfig, client-side JSON round-trip
// via the dashboardState store's /api/state; (2) "Full Workspace
// Configuration" (main.py:1802-1907 / config.controller.ts) — everything
// else, gated by the canExportOrImportConfig role permission. "Copy from
// another workspace instead" reuses WorkspaceOnboardingModal (the same
// component shown on first login to an empty workspace) rather than
// duplicating its picker UI, matching the original's own reuse.
import { Alert, Button } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { onMounted, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useDashboardStateStore } from "../../stores/dashboardState";
import { CONFIG_STORE_LABELS, useWorkspaceConfigStore } from "../../stores/workspaceConfig";
import WorkspaceOnboardingModal from "../onboarding/WorkspaceOnboardingModal.vue";

const store = useWorkspaceConfigStore();
const dashboardStore = useDashboardStateStore();
const auth = useAuthStore();

const canManage = () => auth.hasRiskyAction("canExportOrImportConfig");

// --- Dashboard layout only ---
function exportDashboard() {
  const payload = { ...dashboardStore.dashboard, webhookUrl: dashboardStore.webhookUrl, smtpConfig: dashboardStore.smtpConfig };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "applivery_dashboard_backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

const dashboardImportError = ref<string | null>(null);
const dashboardImportMessage = ref<string | null>(null);
function importDashboard(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  dashboardImportError.value = null;
  dashboardImportMessage.value = null;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed.widgets || !parsed.layout) {
        dashboardImportError.value = "That file doesn't look like a dashboard backup (missing widgets/layout).";
        return;
      }
      const partial: Record<string, any> = { dashboard: { widgets: parsed.widgets, layout: parsed.layout } };
      if (parsed.webhookUrl !== undefined) partial.webhookUrl = parsed.webhookUrl;
      if (parsed.smtpConfig !== undefined) partial.smtpConfig = parsed.smtpConfig;
      await dashboardStore.saveState(partial);
      await dashboardStore.fetchState();
      dashboardImportMessage.value = "Dashboard layout and settings successfully imported.";
    } catch {
      dashboardImportError.value = "That file isn't valid JSON.";
    }
  };
  reader.readAsText(file);
}

// --- Full Workspace Configuration ---
const exporting = ref(false);
const importing = ref(false);
const message = ref<string | null>(null);
const errorMsg = ref<string | null>(null);

const importBundle = ref<{ schemaVersion: number; workspaceSlug: string; exportedAt: string; data: Record<string, any> } | null>(null);
const importSelected = ref<Record<string, boolean>>({});

function itemCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

async function exportConfig() {
  exporting.value = true;
  errorMsg.value = null;
  try {
    const bundle = await store.exportConfig();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soar-config-${auth.orgSlug}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.detail || "Failed to export configuration.";
  } finally {
    exporting.value = false;
  }
}

function onImportFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      importBundle.value = parsed;
      importSelected.value = Object.fromEntries(Object.keys(parsed.data ?? {}).map((k) => [k, false]));
    } catch {
      errorMsg.value = "That file isn't valid JSON.";
    }
  };
  reader.readAsText(file);
}

async function confirmImport() {
  if (!importBundle.value) return;
  importing.value = true;
  errorMsg.value = null;
  message.value = null;
  try {
    const stores = Object.entries(importSelected.value).filter(([, v]) => v).map(([k]) => k);
    const res = await store.importConfig(importBundle.value, stores);
    message.value = `Imported: ${res.imported.join(", ") || "none"}.` + (res.failed.length ? ` Failed: ${res.failed.map((f) => f.store).join(", ")}.` : "");
    importBundle.value = null;
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.detail || "Import failed.";
  } finally {
    importing.value = false;
  }
}

const cloneModalOpen = ref(false);

onMounted(async () => {
  await store.fetchStatus();
  if (!dashboardStore.isLoaded) await dashboardStore.fetchState();
});
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900">Backup &amp; Restore</h3>
      <p class="text-[11px] mb-2 text-gray-400">Dashboard layout only (widgets, webhook URL, SMTP settings) — not Policies, Workflows, or other workspace config. See "Full Workspace Configuration" below for that.</p>
    </div>

    <Alert v-if="dashboardImportError" type="danger">{{ dashboardImportError }}</Alert>
    <Alert v-if="dashboardImportMessage" type="success">{{ dashboardImportMessage }}</Alert>

    <div class="flex gap-4 p-5 rounded-xl border border-gray-200 bg-white shadow-sm">
      <button class="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-brand-50 hover:border-brand-500 hover:text-brand-600 transition-colors" @click="exportDashboard">
        <component :is="ICONS.Download" :size="16" weight="Linear" /> Export JSON
      </button>
      <label class="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 cursor-pointer hover:bg-brand-50 hover:border-brand-500 hover:text-brand-600 transition-colors">
        <component :is="ICONS.CloudDownload" :size="16" weight="Linear" /> Import JSON
        <input type="file" accept=".json" class="hidden" @change="importDashboard" />
      </label>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900">Full Workspace Configuration</h3>
      <p class="text-[11px] mb-2 leading-relaxed text-gray-500">
        Compliance Policies, Workflows, Triggers, Integrations, Case Auto-Run Rules, Case SLA thresholds, Threat Intel providers, the Applivery inbound webhook config, the Action Library, App Lists, the Script Library, and dashboard settings — everything configured for the <strong>{{ auth.orgSlug }}</strong> workspace, bundled into one file. Use this for disaster recovery or to migrate a workspace's configuration to another deployment.
      </p>
      <p class="text-[11px] mb-4 font-medium text-red-600">
        This file contains every credential configured for this workspace — Jira/ServiceNow, PagerDuty/Opsgenie, chat webhook URLs, Threat Intel API keys, and the SMTP password are encrypted at rest and stay encrypted in this export; the Applivery webhook secret is not. Store and share it the same way you'd handle any other credential bundle.
      </p>

      <div v-if="!canManage()" class="flex items-start gap-2 px-3 py-2 rounded-lg text-xs mb-4 max-w-xl bg-amber-50 border border-amber-200 text-amber-700">
        <component :is="ICONS.ShieldWarning" :size="14" weight="Linear" class="shrink-0 mt-0.5" />
        Your role doesn't include the "export, import, or clone workspace configuration" permission — these actions are disabled.
      </div>

      <Alert v-if="errorMsg" type="danger">{{ errorMsg }}</Alert>
      <Alert v-if="message" type="info">{{ message }}</Alert>

      <div class="p-5 rounded-xl border border-gray-200 bg-white space-y-4" :class="canManage() ? '' : 'opacity-60'">
        <div class="flex gap-4">
          <Button variant="ghost" class="flex-1" :disabled="!canManage()" :loading="exporting" @click="exportConfig">Export configuration</Button>
          <label class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 text-sm font-medium" :class="canManage() ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed'">
            Choose import file
            <input type="file" accept=".json" class="hidden" :disabled="!canManage()" @change="onImportFileChosen" />
          </label>
        </div>

        <button
          v-if="canManage() && auth.organizations.filter((o) => (o.slug ?? o._id ?? o.id) !== auth.orgSlug).length > 0"
          type="button"
          class="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-500 hover:bg-brand-50 hover:border-brand-500 hover:text-brand-600 transition-colors"
          @click="cloneModalOpen = true"
        >
          <component :is="ICONS.Command" :size="14" weight="Linear" /> Copy from another workspace instead
        </button>
        <p class="text-[10px] -mt-2 text-gray-400">Only works while this workspace ({{ auth.orgSlug }}) has no configuration yet — a one-time bootstrap, not a merge. If it already has config, use Export/Import above instead.</p>

        <div v-if="importBundle" class="pt-3 border-t border-gray-100">
          <p class="text-xs font-semibold mb-1 text-gray-900">
            Bundle from workspace "{{ importBundle.workspaceSlug }}" — exported {{ importBundle.exportedAt ? new Date(importBundle.exportedAt).toLocaleString() : "unknown time" }}
          </p>
          <p class="text-[11px] mb-3 text-gray-500">Select which items to import. Each selected item OVERWRITES the current one in this workspace ({{ auth.orgSlug }}) — this is a restore, not a merge.</p>
          <div class="space-y-1.5 max-h-56 overflow-y-auto">
            <label v-for="key in Object.keys(importBundle.data)" :key="key" class="flex items-center gap-2 text-xs cursor-pointer text-gray-900">
              <input type="checkbox" v-model="importSelected[key]" :disabled="!canManage()" />
              {{ CONFIG_STORE_LABELS[key] || key }}
              <span class="text-gray-400">({{ itemCount(importBundle.data[key]) }})</span>
            </label>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <Button variant="ghost" size="sm" @click="importBundle = null">Cancel</Button>
            <Button size="sm" :disabled="!canManage()" :loading="importing" @click="confirmImport">Overwrite &amp; import</Button>
          </div>
        </div>
      </div>
    </div>

    <WorkspaceOnboardingModal v-if="cloneModalOpen" @close="cloneModalOpen = false" @cloned="cloneModalOpen = false; store.fetchStatus()" />
  </div>
</template>
