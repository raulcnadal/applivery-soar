<script setup lang="ts">
// Create/edit a Chat/Ticketing/Paging integration. Port of IntegrationPayload
// (main.py:13300-13340) — config shape depends on `type`.
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useIntegrationsStore, type Integration } from "../../stores/integrations";

const props = defineProps<{ open: boolean; integration: Integration | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useIntegrationsStore();
const auth = useAuthStore();
const canEdit = () => auth.hasRiskyAction("canEditIntegrationSecrets");

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

const form = reactive<IntegrationForm>(blankForm());
const isSaving = ref(false);
const isTesting = ref(false);
const testResult = ref<string | null>(null);
const saveError = ref<string | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  const i = props.integration;
  const cfg = i?.config ?? {};
  Object.assign(form, blankForm(), {
    name: i?.name ?? "", type: i?.type ?? "slack", enabled: i?.enabled ?? true,
    notifyOnOpen: i?.notifyOnOpen ?? true, notifyOnClose: i?.notifyOnClose ?? false, minSeverity: i?.minSeverity ?? "low",
    autoCloseCaseOnRemoteResolve: i?.autoCloseCaseOnRemoteResolve ?? false, notifyOnSystemHealth: i?.notifyOnSystemHealth ?? false,
    webhookUrl: cfg.webhookUrl ?? "", url: cfg.url ?? "", headers: cfg.headers ? JSON.stringify(cfg.headers) : "",
    baseUrl: cfg.baseUrl ?? "", email: cfg.email ?? "", apiToken: cfg.apiToken ?? "", projectKey: cfg.projectKey ?? "", issueType: cfg.issueType ?? "Task",
    instanceUrl: cfg.instanceUrl ?? "", username: cfg.username ?? "", password: cfg.password ?? "", table: cfg.table ?? "incident",
    routingKey: cfg.routingKey ?? "", apiKey: cfg.apiKey ?? "", region: cfg.region ?? "us",
  });
  saveError.value = null;
  testResult.value = null;
});

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
    if (props.integration) await store.updateIntegration(props.integration.id, payload);
    else await store.createIntegration(payload);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save integration.";
  } finally {
    isSaving.value = false;
  }
}

async function runTest(dryRun: boolean) {
  if (!props.integration) return;
  isTesting.value = true;
  testResult.value = null;
  try {
    const res = await store.testIntegration(props.integration.id, dryRun);
    testResult.value = res.detail || "Test succeeded.";
  } catch (err: any) {
    testResult.value = err?.response?.data?.detail || "Test failed.";
  } finally {
    isTesting.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="integration ? `Edit “${integration.name}”` : 'New integration'" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Alert v-if="testResult" type="info">{{ testResult }}</Alert>
      <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>

      <div class="space-y-3" :class="canEdit() ? '' : 'opacity-60 pointer-events-none'">
      <Input v-model="form.name" label="Name" />
      <Input
        :model-value="form.type"
        type="select"
        :options="['slack', 'teams', 'discord', 'jira', 'servicenow', 'generic_webhook', 'pagerduty', 'opsgenie'].map((t) => ({ value: t, label: t }))"
        label="Type"
        @update:model-value="form.type = $event as string"
      />

      <template v-if="form.type === 'slack' || form.type === 'teams' || form.type === 'discord'">
        <Input v-model="form.webhookUrl" label="Webhook URL" />
      </template>
      <template v-else-if="form.type === 'generic_webhook'">
        <Input v-model="form.url" label="URL" />
        <Input v-model="form.headers" label="Headers (JSON, optional)" placeholder='{"Authorization": "Bearer ..."}' />
      </template>
      <template v-else-if="form.type === 'jira'">
        <Input v-model="form.baseUrl" label="Base URL" placeholder="https://yourcompany.atlassian.net" />
        <div class="grid grid-cols-2 gap-2">
          <Input v-model="form.email" label="Email" />
          <Input v-model="form.apiToken" type="password" label="API token" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Input v-model="form.projectKey" label="Project key" />
          <Input v-model="form.issueType" label="Issue type" />
        </div>
      </template>
      <template v-else-if="form.type === 'servicenow'">
        <Input v-model="form.instanceUrl" label="Instance URL" />
        <div class="grid grid-cols-2 gap-2">
          <Input v-model="form.username" label="Username" />
          <Input v-model="form.password" type="password" label="Password" />
        </div>
        <Input v-model="form.table" label="Table" placeholder="incident" />
      </template>
      <template v-else-if="form.type === 'pagerduty'">
        <Input v-model="form.routingKey" type="password" label="Events API v2 routing key" />
      </template>
      <template v-else-if="form.type === 'opsgenie'">
        <Input v-model="form.apiKey" type="password" label="API (Genie) key" />
        <Input
          :model-value="form.region"
          type="select"
          :options="[{ value: 'us', label: 'US' }, { value: 'eu', label: 'EU' }]"
          label="Region"
          @update:model-value="form.region = $event as string"
        />
      </template>

      <div class="grid grid-cols-2 gap-2 pt-2">
        <Input
          :model-value="form.minSeverity"
          type="select"
          :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))"
          label="Minimum severity to notify"
          @update:model-value="form.minSeverity = $event as string"
        />
      </div>
      <div class="flex flex-wrap gap-4">
        <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.enabled" /> Enabled</label>
        <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.notifyOnOpen" /> Notify on open</label>
        <label v-if="form.type !== 'jira' && form.type !== 'servicenow'" class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.notifyOnClose" /> Notify on close</label>
        <label v-if="form.type === 'jira' || form.type === 'servicenow'" class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.autoCloseCaseOnRemoteResolve" /> Auto-close case when ticket resolves</label>
        <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.notifyOnSystemHealth" /> Page on background-job failure</label>
      </div>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!canEdit() || !form.name" @click="save">{{ integration ? "Save changes" : "Create integration" }}</Button>
        <Button v-if="integration" variant="secondary" :disabled="!canEdit()" :loading="isTesting" @click="runTest(true)">Validate config</Button>
        <Button v-if="integration && form.type !== 'jira' && form.type !== 'servicenow'" variant="ghost" :disabled="!canEdit()" :loading="isTesting" @click="runTest(false)">Send test</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
