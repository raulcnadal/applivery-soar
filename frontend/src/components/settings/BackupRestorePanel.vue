<script setup lang="ts">
// Backup & Restore (Full Workspace Configuration) tab. Port of
// main.py:1802-1907 (workspace-status/clone-from/export/import).
// Dashboard-layout-only export/import (webhookUrl/smtpConfig/widgets) is a
// separate, Phase 7 concern (/api/state) — this panel only covers the real
// configuration bundle (Compliance Policies, Workflows, Integrations, etc).
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { CONFIG_STORE_LABELS, useWorkspaceConfigStore } from "../../stores/workspaceConfig";

const store = useWorkspaceConfigStore();
const auth = useAuthStore();

const exporting = ref(false);
const importing = ref(false);
const cloning = ref(false);
const message = ref<string | null>(null);
const errorMsg = ref<string | null>(null);

const importBundle = ref<{ schemaVersion: number; workspaceSlug: string; exportedAt: string; data: Record<string, any> } | null>(null);
const importSelected = ref<Record<string, boolean>>({});

const cloneSourceSlug = ref("");
const cloneSelected = ref<Record<string, boolean>>({});

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

async function confirmClone() {
  cloning.value = true;
  errorMsg.value = null;
  message.value = null;
  try {
    const stores = Object.entries(cloneSelected.value).filter(([, v]) => v).map(([k]) => k);
    const res = await store.cloneFrom(cloneSourceSlug.value, stores);
    message.value = `Cloned from "${res.sourceWorkspaceSlug}": ${res.cloned.join(", ") || "none"}.`;
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.detail || "Clone failed.";
  } finally {
    cloning.value = false;
  }
}

onMounted(async () => {
  await store.fetchStatus();
  cloneSelected.value = Object.fromEntries(Object.keys(CONFIG_STORE_LABELS).map((k) => [k, false]));
});
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900">Full Workspace Configuration</h3>
      <p class="text-[11px] mb-2 leading-relaxed text-gray-500">
        Compliance Policies, Workflows, Triggers, Integrations, Case Auto-Run Rules, Case SLA thresholds, Threat Intel providers, the Applivery inbound webhook config, the Action Library, App Lists, the Script Library, and Vulnerability Service config — everything configured for the <strong>{{ auth.orgSlug }}</strong> workspace, bundled into one file.
      </p>
      <p class="text-[11px] mb-4 font-medium text-red-600">
        This file contains every credential configured for this workspace — most secret fields are encrypted at rest and stay encrypted in this export, but the Applivery webhook secret is not. Handle it like any other credential bundle.
      </p>
    </div>

    <Alert v-if="errorMsg" type="danger">{{ errorMsg }}</Alert>
    <Alert v-if="message" type="info">{{ message }}</Alert>

    <div class="p-5 rounded-xl border border-gray-200 bg-white space-y-4">
      <div class="flex gap-4">
        <Button variant="ghost" class="flex-1" :loading="exporting" @click="exportConfig">Export configuration</Button>
        <label class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 text-sm font-medium cursor-pointer hover:bg-gray-50">
          Choose import file
          <input type="file" accept=".json" class="hidden" @change="onImportFileChosen" />
        </label>
      </div>

      <div v-if="importBundle" class="pt-3 border-t border-gray-100">
        <p class="text-xs font-semibold mb-1 text-gray-900">
          Bundle from workspace "{{ importBundle.workspaceSlug }}" — exported {{ importBundle.exportedAt ? new Date(importBundle.exportedAt).toLocaleString() : "unknown time" }}
        </p>
        <p class="text-[11px] mb-3 text-gray-500">Select which items to import. Each selected item OVERWRITES the current one in this workspace ({{ auth.orgSlug }}) — this is a restore, not a merge.</p>
        <div class="space-y-1.5 max-h-56 overflow-y-auto">
          <label v-for="key in Object.keys(importBundle.data)" :key="key" class="flex items-center gap-2 text-xs cursor-pointer text-gray-900">
            <input type="checkbox" v-model="importSelected[key]" />
            {{ CONFIG_STORE_LABELS[key] || key }}
          </label>
        </div>
        <div class="flex justify-end gap-2 mt-3">
          <Button variant="ghost" size="sm" @click="importBundle = null">Cancel</Button>
          <Button size="sm" :loading="importing" @click="confirmImport">Overwrite & import</Button>
        </div>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-bold mb-2 text-gray-900">Clone from another workspace</h3>
      <p class="text-[11px] mb-3 leading-relaxed text-gray-500">
        Bootstraps <strong>{{ auth.orgSlug }}</strong> from another workspace's configuration — only works while this workspace has no configuration yet. Use Export/Import above if it already has config.
      </p>
      <div class="p-5 rounded-xl border border-gray-200 bg-white space-y-3">
        <Input v-model="cloneSourceSlug" label="Source workspace slug" placeholder="e.g. acme-prod" />
        <div class="space-y-1.5 max-h-56 overflow-y-auto">
          <label v-for="(label, key) in CONFIG_STORE_LABELS" :key="key" class="flex items-center gap-2 text-xs cursor-pointer text-gray-900">
            <input type="checkbox" v-model="cloneSelected[key]" />
            {{ label }}
          </label>
        </div>
        <div class="flex justify-end">
          <Button size="sm" :disabled="!cloneSourceSlug" :loading="cloning" @click="confirmClone">Clone into this workspace</Button>
        </div>
      </div>
    </div>
  </div>
</template>
