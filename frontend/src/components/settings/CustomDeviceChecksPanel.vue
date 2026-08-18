<script setup lang="ts">
// "Custom Device Checks" tab — disclosed new feature, no main.py/App.jsx
// equivalent. Lets an admin define what the Applivery SOAR Agent (Settings >
// Device Data Webhook) should check on a device beyond the fixed attribute
// set: process running, service/daemon status, a registry value / plist key
// / file, an installed app + version, or a raw command. Each check's result
// becomes selectable immediately inside the Compliance Policy Builder as a
// "Custom Check Result" condition (ConditionRow.vue), scoped automatically
// to the matching platform. See backend's customChecks.service.ts module
// doc for the full design and the security trade-off note on the "command"
// checker type.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { computed, onMounted, reactive, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useComplianceStore, CHECKER_TYPES, type CheckerType, type CustomCheckDefinition } from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";

const store = useComplianceStore();
const auth = useAuthStore();
const canEdit = () => auth.hasFeatureAccess("compliance", "manage");

const platform = ref<"windows" | "macos">("windows");

const CHECKER_LABELS: Record<CheckerType, string> = {
  processRunning: "Process running",
  serviceStatus: "Service / daemon status",
  registryOrFileValue: "Registry / plist / file value",
  appInstalled: "App installed + version",
  command: "Run a command (advanced — full remote execution)",
};

// null = list view, "new" = creating, else the check id being edited.
const isEditing = ref<string | null>(null);
const form = reactive({
  name: "",
  description: "",
  checkerType: "processRunning" as CheckerType,
  enabled: true,
  params: {} as Record<string, string>,
});
const saveError = ref<string | null>(null);
const isSaving = ref(false);

const filteredChecks = computed(() => store.customChecks.filter((c) => c.platform === platform.value));

function resetForm() {
  form.name = "";
  form.description = "";
  form.checkerType = "processRunning";
  form.enabled = true;
  form.params = {};
}

function startCreate() {
  resetForm();
  isEditing.value = "new";
}

function startEdit(check: CustomCheckDefinition) {
  form.name = check.name;
  form.description = check.description ?? "";
  form.checkerType = check.checkerType;
  form.enabled = check.enabled;
  form.params = { ...(check.params ?? {}) };
  isEditing.value = check.id;
}

function cancelEdit() {
  isEditing.value = null;
  saveError.value = null;
  resetForm();
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = {
      platform: platform.value,
      name: form.name,
      description: form.description || null,
      checkerType: form.checkerType,
      params: form.params,
      enabled: form.enabled,
    };
    if (isEditing.value === "new") {
      await store.createCustomCheck(payload);
    } else if (isEditing.value) {
      await store.updateCustomCheck(isEditing.value, payload);
    }
    cancelEdit();
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save check.";
  } finally {
    isSaving.value = false;
  }
}

async function remove(check: CustomCheckDefinition) {
  if (!confirm(`Delete "${check.name}"? Any Compliance Policy condition referencing it will stop matching.`)) return;
  await store.deleteCustomCheck(check.id);
}

async function toggleEnabled(check: CustomCheckDefinition) {
  await store.updateCustomCheck(check.id, {
    platform: check.platform,
    name: check.name,
    description: check.description,
    checkerType: check.checkerType,
    params: check.params,
    enabled: !check.enabled,
  });
}

function targetSummary(check: CustomCheckDefinition): string {
  const p = check.params || {};
  switch (check.checkerType) {
    case "processRunning":
      return p.processName || "";
    case "serviceStatus":
      return p.serviceName || "";
    case "registryOrFileValue":
      if (check.platform === "windows") return `${p.registryPath || ""} \\ ${p.valueName || ""}`;
      return p.plistKey ? `${p.path || ""} : ${p.plistKey}` : p.path || "";
    case "appInstalled":
      return p.identifier || "";
    case "command":
      return p.command || "";
    default:
      return "";
  }
}

onMounted(async () => {
  await store.fetchCustomChecks();
});
</script>

<template>
  <div>
    <h3 class="text-sm font-bold mb-2 text-gray-900 dark:text-white">Custom Device Checks</h3>
    <div class="space-y-4 max-w-2xl">
      <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        Define what the Applivery SOAR Agent should check on a device beyond the fixed attribute set — is a named process
        running (e.g. an EDR), a service/daemon active, a registry value or plist key set to a given value, an app
        installed at a given version, or the output of an arbitrary command. Each check's result becomes available
        immediately as a "Custom Check Result" condition inside Compliance Policies, scoped automatically to policies
        targeting the matching platform. Requires the Applivery SOAR Agent, configured under Settings &gt; Applivery
        SOAR Agent — the legacy report scripts don't poll for custom checks.
      </p>
      <Alert type="warning">
        The "Run a command" checker type executes exactly what you enter, directly on every device with that check
        enabled — the same power as remote shell access. Treat it with the same caution you'd give any other
        remote-execution tool, and prefer the structured checker types above it when they cover what you need.
      </Alert>
      <Alert v-if="store.customChecksError" type="danger">{{ store.customChecksError }}</Alert>
      <Alert v-if="!canEdit()" type="info">Your role doesn't have manage access to Compliance — every control below is disabled.</Alert>

      <div class="flex items-center gap-1.5">
        <button
          v-for="p in ['windows', 'macos']"
          :key="p"
          type="button"
          class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors"
          :class="platform === p ? 'text-white' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'"
          :style="platform === p ? { backgroundColor: PRIMARY_BLUE, borderColor: PRIMARY_BLUE } : {}"
          @click="platform = p as 'windows' | 'macos'"
        >
          {{ p === "windows" ? "Windows" : "macOS" }}
        </button>
        <div class="flex-1" />
        <Button v-if="canEdit() && isEditing === null" size="sm" @click="startCreate">+ New check</Button>
      </div>

      <div v-if="isEditing !== null" class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-2">
        <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
        <Input v-model="form.name" label="Name" placeholder="e.g. CrowdStrike running" :disabled="!canEdit()" />
        <Input v-model="form.description" label="Description (optional)" :disabled="!canEdit()" />
        <div>
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Checker type</label>
          <select
            v-model="form.checkerType"
            :disabled="!canEdit()"
            class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          >
            <option v-for="t in CHECKER_TYPES" :key="t" :value="t">{{ CHECKER_LABELS[t] }}</option>
          </select>
        </div>

        <Input v-if="form.checkerType === 'processRunning'" v-model="form.params.processName" label="Process name" placeholder="CrowdStrike.exe / falcond" :disabled="!canEdit()" />

        <Input
          v-if="form.checkerType === 'serviceStatus'"
          v-model="form.params.serviceName"
          :label="platform === 'windows' ? 'Service name' : 'Launchd label'"
          :placeholder="platform === 'windows' ? 'csagent' : 'com.crowdstrike.falcon.Agent'"
          :disabled="!canEdit()"
        />

        <template v-if="form.checkerType === 'registryOrFileValue' && platform === 'windows'">
          <Input v-model="form.params.registryPath" label="Registry key path" placeholder="HKLM\SOFTWARE\CrowdStrike" :disabled="!canEdit()" />
          <Input v-model="form.params.valueName" label="Value name" placeholder="AgentVersion" :disabled="!canEdit()" />
        </template>
        <template v-if="form.checkerType === 'registryOrFileValue' && platform === 'macos'">
          <Input v-model="form.params.path" label="File or plist path" placeholder="/Library/CS/CSConfig.plist" :disabled="!canEdit()" />
          <Input v-model="form.params.plistKey" label="Plist key (leave blank to just check the path exists)" placeholder="AgentVersion" :disabled="!canEdit()" />
        </template>

        <Input
          v-if="form.checkerType === 'appInstalled'"
          v-model="form.params.identifier"
          :label="platform === 'windows' ? 'Winget package ID (or app display name)' : 'Bundle identifier'"
          :placeholder="platform === 'windows' ? 'CrowdStrike.Falcon' : 'com.crowdstrike.falcon'"
          :disabled="!canEdit()"
        />

        <div v-if="form.checkerType === 'command'">
          <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Command ({{ platform === "windows" ? "PowerShell" : "bash" }})</label>
          <textarea
            v-model="form.params.command"
            rows="3"
            :disabled="!canEdit()"
            class="w-full px-2 py-1.5 rounded-lg text-xs font-mono outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
            placeholder="Get-Service csagent | Select-Object -Expand Status"
          />
        </div>

        <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" v-model="form.enabled" :disabled="!canEdit()" /> Enabled
        </label>

        <div class="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" @click="cancelEdit">Cancel</Button>
          <Button size="sm" :loading="isSaving" :disabled="!canEdit() || !form.name" @click="save">{{ isEditing === "new" ? "Create" : "Save" }}</Button>
        </div>
      </div>

      <p v-if="filteredChecks.length === 0 && isEditing === null" class="text-xs text-gray-500 dark:text-gray-400">
        No {{ platform === "windows" ? "Windows" : "macOS" }} checks yet.
      </p>

      <div class="space-y-1.5">
        <div v-for="check in filteredChecks" :key="check.id" class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="check.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'" />
              <p class="text-xs font-semibold truncate text-gray-900 dark:text-white">{{ check.name }}</p>
              <span class="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400">{{ check.key }}</span>
            </div>
            <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate">{{ CHECKER_LABELS[check.checkerType] }} — {{ targetSummary(check) }}</p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" :disabled="!canEdit()" @click="toggleEnabled(check)">{{ check.enabled ? "Disable" : "Enable" }}</Button>
            <Button size="sm" variant="ghost" :disabled="!canEdit()" @click="startEdit(check)">Edit</Button>
            <button type="button" class="p-1.5 rounded disabled:opacity-40" style="color: #ef4444" :disabled="!canEdit()" @click="remove(check)">
              <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
