<script setup lang="ts">
// Create/edit a Threat Intel provider. Port of ThreatIntelProviderPayload
// (main.py:14228-14235).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useThreatIntelStore, type ThreatIntelProvider } from "../../stores/threatIntel";

const props = defineProps<{ open: boolean; provider: ThreatIntelProvider | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useThreatIntelStore();
const auth = useAuthStore();
const canEdit = () => auth.hasRiskyAction("canEditIntegrationSecrets");

const form = reactive({ name: "", type: "virustotal", enabled: true, apiKey: "", urlTemplate: "", headers: "" });
const isSaving = ref(false);
const isTesting = ref(false);
const testResult = ref<string | null>(null);
const saveError = ref<string | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  const p = props.provider;
  const cfg = p?.config ?? {};
  Object.assign(form, {
    name: p?.name ?? "", type: p?.type ?? "virustotal", enabled: p?.enabled ?? true,
    apiKey: cfg.apiKey ?? "", urlTemplate: cfg.urlTemplate ?? "", headers: cfg.headers ? JSON.stringify(cfg.headers) : "",
  });
  saveError.value = null;
  testResult.value = null;
});

function buildConfig(): Record<string, any> {
  if (form.type === "generic_rest") {
    let headers: Record<string, string> = {};
    try { headers = form.headers ? JSON.parse(form.headers) : {}; } catch { /* ignore malformed JSON */ }
    return { urlTemplate: form.urlTemplate, headers };
  }
  return { apiKey: form.apiKey };
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = { name: form.name, type: form.type, enabled: form.enabled, config: buildConfig() };
    if (props.provider) await store.updateProvider(props.provider.id, payload);
    else await store.createProvider(payload);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save provider.";
  } finally {
    isSaving.value = false;
  }
}

async function runTest() {
  if (!props.provider) return;
  isTesting.value = true;
  testResult.value = null;
  try {
    const res = await store.testProvider(props.provider.id);
    testResult.value = res.result?.detail || "Test succeeded.";
  } catch (err: any) {
    testResult.value = err?.response?.data?.detail || "Test failed.";
  } finally {
    isTesting.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="provider ? `Edit “${provider.name}”` : 'New threat intel provider'" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Alert v-if="testResult" type="info">{{ testResult }}</Alert>
      <Alert v-if="!canEdit()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>

      <Input v-model="form.name" label="Name" :disabled="!canEdit()" />
      <Input
        :model-value="form.type"
        type="select"
        :disabled="!canEdit()"
        :options="[
          { value: 'virustotal', label: 'VirusTotal' },
          { value: 'abuseipdb', label: 'AbuseIPDB' },
          { value: 'hibp', label: 'Have I Been Pwned' },
          { value: 'generic_rest', label: 'Generic REST' },
        ]"
        label="Type"
        @update:model-value="form.type = $event as string"
      />

      <template v-if="form.type === 'generic_rest'">
        <Input v-model="form.urlTemplate" label="URL template" placeholder="https://api.example.com/lookup?q={{ ioc }}" :disabled="!canEdit()" />
        <Input v-model="form.headers" label="Headers (JSON, optional)" :disabled="!canEdit()" />
      </template>
      <template v-else>
        <Input v-model="form.apiKey" type="password" label="API key" :disabled="!canEdit()" />
      </template>

      <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="form.enabled" :disabled="!canEdit()" /> Enabled</label>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!canEdit() || !form.name" @click="save">{{ provider ? "Save changes" : "Add provider" }}</Button>
        <Button v-if="provider" variant="secondary" :disabled="!canEdit()" :loading="isTesting" @click="runTest">Test</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
