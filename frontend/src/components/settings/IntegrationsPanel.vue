<script setup lang="ts">
// Ticketing & Chat integrations Settings tab. Port of IntegrationsSettings.jsx
// (wow-dashboard/src/components/settings/IntegrationsSettings.jsx).
//
// Deliberately NOT a Modal — the original renders create/edit inline, above
// the integration card list, toggled by local `editing` state. Replaces the
// former IntegrationsTable.vue + IntegrationDialog.vue pair (same
// architecture fix already applied to Roles/CaseAutoRunRules: the Modal
// rendered behind SettingsModal.vue's own overlay because this feature was
// never supposed to be a Modal in the first place).
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useAuthStore } from "../../stores/auth";
import { useIntegrationsStore, type Integration } from "../../stores/integrations";

const store = useIntegrationsStore();
const auth = useAuthStore();
const canManage = () => auth.hasRiskyAction("canEditIntegrationSecrets");

const TYPE_META: Record<string, { label: string; hint: string }> = {
  slack: { label: "Slack", hint: "Incoming webhook URL from a Slack app." },
  teams: { label: "Microsoft Teams", hint: "Incoming webhook URL from a Teams channel connector." },
  discord: { label: "Discord", hint: "Incoming webhook URL from a Discord channel." },
  jira: { label: "Jira", hint: "Opens/updates a Jira issue per Case." },
  servicenow: { label: "ServiceNow", hint: "Opens/updates a ServiceNow incident per Case." },
  generic_webhook: { label: "Generic webhook", hint: "POSTs a JSON payload to any URL, with optional custom headers." },
  pagerduty: { label: "PagerDuty", hint: "Triggers a PagerDuty Events API v2 alert." },
  opsgenie: { label: "Opsgenie", hint: "Triggers an Opsgenie alert." },
};
const TYPE_OPTIONS = Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label }));

interface IntegrationForm {
  name: string; type: string; enabled: boolean;
  notifyOnOpen: boolean; notifyOnClose: boolean; minSeverity: string;
  autoCloseCaseOnRemoteResolve: boolean; notifyOnSystemHealth: boolean;
  webhookUrl: string; url: string; headers: string;
  baseUrl: string; email: string; apiToken: string; projectKey: string; issueType: string;
  instanceUrl: string; username: string; password: string; table: string;
  routingKey: string; apiKey: string; region: string;
}
function blankForm(): IntegrationForm {
  return {
    name: "", type: "slack", enabled: true, notifyOnOpen: true, notifyOnClose: false, minSeverity: "low",
    autoCloseCaseOnRemoteResolve: false, notifyOnSystemHealth: false,
    webhookUrl: "", url: "", headers: "",
    baseUrl: "", email: "", apiToken: "", projectKey: "", issueType: "Task",
    instanceUrl: "", username: "", password: "", table: "incident",
    routingKey: "", apiKey: "", region: "us",
  };
}

const editing = ref<Integration | null | undefined>(undefined);
const form = reactive<IntegrationForm>(blankForm());
const isSaving = ref(false);
const saveError = ref<string | null>(null);

// dry-run checkbox + last test feedback are per-row, not per-form — matches
// the original's card-level "Dry run" checkbox next to each Test button.
const dryRunByRow = reactive<Record<string, boolean>>({});
const testingRow = ref<string | null>(null);
const testResultByRow = reactive<Record<string, string>>({});

function openNew() {
  editing.value = null;
  Object.assign(form, blankForm());
  saveError.value = null;
}
function openEdit(i: Integration) {
  editing.value = i;
  const cfg = i.config ?? {};
  Object.assign(form, blankForm(), {
    name: i.name, type: i.type, enabled: i.enabled,
    notifyOnOpen: i.notifyOnOpen, notifyOnClose: i.notifyOnClose, minSeverity: i.minSeverity,
    autoCloseCaseOnRemoteResolve: i.autoCloseCaseOnRemoteResolve, notifyOnSystemHealth: i.notifyOnSystemHealth,
    webhookUrl: cfg.webhookUrl ?? "", url: cfg.url ?? "", headers: cfg.headers ? JSON.stringify(cfg.headers) : "",
    baseUrl: cfg.baseUrl ?? "", email: cfg.email ?? "", apiToken: cfg.apiToken ?? "", projectKey: cfg.projectKey ?? "", issueType: cfg.issueType ?? "Task",
    instanceUrl: cfg.instanceUrl ?? "", username: cfg.username ?? "", password: cfg.password ?? "", table: cfg.table ?? "incident",
    routingKey: cfg.routingKey ?? "", apiKey: cfg.apiKey ?? "", region: cfg.region ?? "us",
  });
  saveError.value = null;
}
function closeEditor() {
  editing.value = undefined;
}

async function remove(i: Integration) {
  if (!confirm(`Delete integration "${i.name}"?`)) return;
  await store.deleteIntegration(i.id);
}

function buildConfig(): Record<string, any> {
  switch (form.type) {
    case "slack": case "teams": case "discord":
      return { webhookUrl: form.webhookUrl };
    case "generic_webhook": {
      let headers: Record<string, string> = {};
      try { headers = form.headers ? JSON.parse(form.headers) : {}; } catch { /* ignore malformed JSON, send empty */ }
      return { url: form.url, headers };
    }
    case "jira":
      return { baseUrl: form.baseUrl, email: form.email, apiToken: form.apiToken, projectKey: form.projectKey, issueType: form.issueType };
    case "servicenow":
      return { instanceUrl: form.instanceUrl, username: form.username, password: form.password, table: form.table };
    case "pagerduty":
      return { routingKey: form.routingKey };
    case "opsgenie":
      return { apiKey: form.apiKey, region: form.region };
    default:
      return {};
  }
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  const payload = {
    name: form.name, type: form.type, enabled: form.enabled,
    notifyOnOpen: form.notifyOnOpen, notifyOnClose: form.notifyOnClose, minSeverity: form.minSeverity,
    autoCloseCaseOnRemoteResolve: form.autoCloseCaseOnRemoteResolve, notifyOnSystemHealth: form.notifyOnSystemHealth,
    config: buildConfig(),
  };
  try {
    if (editing.value) await store.updateIntegration(editing.value.id, payload);
    else await store.createIntegration(payload);
    closeEditor();
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save integration.";
  } finally {
    isSaving.value = false;
  }
}

async function runTest(i: Integration) {
  testingRow.value = i.id;
  delete testResultByRow[i.id];
  try {
    const res = await store.testIntegration(i.id, dryRunByRow[i.id] ?? true);
    testResultByRow[i.id] = res.detail || "Test succeeded.";
  } catch (err: any) {
    testResultByRow[i.id] = err?.response?.data?.detail || "Test failed.";
  } finally {
    testingRow.value = null;
  }
}

onMounted(async () => {
  if (store.integrations.length === 0) await store.fetchIntegrations();
});
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-sm font-bold text-gray-900 dark:text-white">Ticketing &amp; Chat</h3>
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      Notifies chat/paging tools or opens tickets when a Case opens or closes. Ticketing types (Jira, ServiceNow) can also
      auto-close the Case back here when the remote ticket resolves.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="!canManage()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>

    <form v-if="editing !== undefined" class="p-4 rounded-xl mb-3 space-y-3 border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800" :class="canManage() ? '' : 'opacity-60 pointer-events-none'" @submit.prevent="save">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" :disabled="!canManage()" />
      <Input :model-value="form.type" type="select" :options="TYPE_OPTIONS" label="Type" :disabled="!canManage()" @update:model-value="form.type = $event as string" />
      <p class="text-[11px] text-gray-400 -mt-2">{{ TYPE_META[form.type]?.hint }}</p>

      <template v-if="form.type === 'slack' || form.type === 'teams' || form.type === 'discord'">
        <Input v-model="form.webhookUrl" label="Webhook URL" :disabled="!canManage()" />
      </template>
      <template v-else-if="form.type === 'generic_webhook'">
        <Input v-model="form.url" label="URL" :disabled="!canManage()" />
        <Input v-model="form.headers" label="Headers (JSON, optional)" placeholder='{"Authorization": "Bearer ..."}' :disabled="!canManage()" />
      </template>
      <template v-else-if="form.type === 'jira'">
        <Input v-model="form.baseUrl" label="Base URL" placeholder="https://yourcompany.atlassian.net" :disabled="!canManage()" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input v-model="form.email" label="Email" :disabled="!canManage()" />
          <Input v-model="form.apiToken" type="password" label="API token" :disabled="!canManage()" />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input v-model="form.projectKey" label="Project key" :disabled="!canManage()" />
          <Input v-model="form.issueType" label="Issue type" :disabled="!canManage()" />
        </div>
      </template>
      <template v-else-if="form.type === 'servicenow'">
        <Input v-model="form.instanceUrl" label="Instance URL" :disabled="!canManage()" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input v-model="form.username" label="Username" :disabled="!canManage()" />
          <Input v-model="form.password" type="password" label="Password" :disabled="!canManage()" />
        </div>
        <Input v-model="form.table" label="Table" placeholder="incident" :disabled="!canManage()" />
      </template>
      <template v-else-if="form.type === 'pagerduty'">
        <Input v-model="form.routingKey" type="password" label="Events API v2 routing key" :disabled="!canManage()" />
      </template>
      <template v-else-if="form.type === 'opsgenie'">
        <Input v-model="form.apiKey" type="password" label="API (Genie) key" :disabled="!canManage()" />
        <Input :model-value="form.region" type="select" :options="[{ value: 'us', label: 'US' }, { value: 'eu', label: 'EU' }]" label="Region" :disabled="!canManage()" @update:model-value="form.region = $event as string" />
      </template>

      <Input :model-value="form.minSeverity" type="select" :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))" label="Minimum severity to notify" :disabled="!canManage()" @update:model-value="form.minSeverity = $event as string" />
      <div class="flex flex-wrap gap-4">
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.enabled" :disabled="!canManage()" /> Enabled</label>
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.notifyOnOpen" :disabled="!canManage()" /> Notify on open</label>
        <label v-if="form.type !== 'jira' && form.type !== 'servicenow'" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.notifyOnClose" :disabled="!canManage()" /> Notify on close</label>
        <label v-if="form.type === 'jira' || form.type === 'servicenow'" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.autoCloseCaseOnRemoteResolve" :disabled="!canManage()" /> Auto-close case when ticket resolves</label>
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.notifyOnSystemHealth" :disabled="!canManage()" /> Page on background-job failure</label>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <Button type="submit" :loading="isSaving" :disabled="!canManage() || !form.name">{{ editing ? "Save changes" : "Create integration" }}</Button>
        <Button variant="ghost" type="button" @click="closeEditor">Cancel</Button>
      </div>
    </form>

    <div v-if="store.integrations.length === 0" class="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      No integrations yet.
    </div>
    <div v-else class="space-y-2">
      <div v-for="i in store.integrations" :key="i.id" class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-1.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <component :is="ICONS.ChatRound" :size="16" weight="Linear" class="shrink-0 text-gray-400" />
            <div class="min-w-0">
              <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ i.name }}</p>
              <p class="text-[11px] text-gray-400">{{ TYPE_META[i.type]?.label ?? i.type }} — min. severity {{ i.minSeverity }} — {{ i.fireCount }} fired{{ i.lastFiredAt ? ` (last ${new Date(i.lastFiredAt).toLocaleString()})` : "" }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: i.enabled ? '#22C55E20' : '#9CA3AF20', color: i.enabled ? '#22C55E' : '#9CA3AF' }">{{ i.enabled ? "Enabled" : "Disabled" }}</span>
            <span v-if="i.lastError" class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background-color: #ef444420; color: #ef4444">Error</span>
            <label class="flex items-center gap-1 text-[10px] text-gray-400"><input type="checkbox" :checked="dryRunByRow[i.id] ?? true" @change="dryRunByRow[i.id] = ($event.target as HTMLInputElement).checked" /> Dry run</label>
            <button type="button" class="text-gray-400 hover:text-brand-600" title="Test" :disabled="!canManage() || testingRow === i.id" @click="runTest(i)"><component :is="ICONS.TestTube" :size="15" weight="Linear" /></button>
            <button type="button" class="text-gray-400 hover:text-brand-600" title="Edit" :disabled="!canManage()" @click="openEdit(i)"><component :is="ICONS.Pen" :size="15" weight="Linear" /></button>
            <button type="button" class="text-gray-400 hover:text-red-500" title="Delete" :disabled="!canManage()" @click="remove(i)"><component :is="ICONS.TrashBinTrash" :size="15" weight="Linear" /></button>
          </div>
        </div>
        <p v-if="i.lastError" class="text-[11px] text-red-500">{{ i.lastError }}</p>
        <p v-if="testResultByRow[i.id]" class="text-[11px] text-gray-500 dark:text-gray-400">{{ testResultByRow[i.id] }}</p>
      </div>
    </div>

    <div v-if="editing === undefined" class="flex justify-start">
      <Button :disabled="!canManage()" @click="openNew">
        <component :is="ICONS.AddCircle" :size="15" weight="Linear" /> New Integration
      </Button>
    </div>
  </div>
</template>
