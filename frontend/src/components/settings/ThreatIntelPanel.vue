<script setup lang="ts">
// Threat Intel providers Settings tab. Port of ThreatIntelSettings.jsx
// (wow-dashboard/src/components/settings/ThreatIntelSettings.jsx).
//
// Deliberately NOT a Modal — same inline-form-above-card-list swap as
// CaseAutoRunRulesPanel.vue / IntegrationsPanel.vue. Replaces the former
// ThreatIntelProvidersTable.vue + ThreatIntelProviderDialog.vue pair.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useAuthStore } from "../../stores/auth";
import { useThreatIntelStore, type ThreatIntelProvider } from "../../stores/threatIntel";

const store = useThreatIntelStore();
const auth = useAuthStore();
const canManage = () => auth.hasRiskyAction("canEditIntegrationSecrets");

const TYPE_META: Record<string, { label: string; hint: string }> = {
  virustotal: { label: "VirusTotal", hint: "Looks up file hashes, IPs, domains, and URLs." },
  abuseipdb: { label: "AbuseIPDB", hint: "Looks up IP reputation/abuse reports." },
  hibp: { label: "Have I Been Pwned", hint: "Looks up whether an email has appeared in a known breach." },
  generic_rest: { label: "Generic REST", hint: "GETs a URL template with the IOC substituted in, with optional custom headers." },
};
const TYPE_OPTIONS = Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label }));

const editing = ref<ThreatIntelProvider | null | undefined>(undefined);
const form = reactive({ name: "", type: "virustotal", enabled: true, apiKey: "", urlTemplate: "", headers: "" });
const isSaving = ref(false);
const saveError = ref<string | null>(null);

const testingRow = ref<string | null>(null);
const testResultByRow = reactive<Record<string, string>>({});

function openNew() {
  editing.value = null;
  Object.assign(form, { name: "", type: "virustotal", enabled: true, apiKey: "", urlTemplate: "", headers: "" });
  saveError.value = null;
}
function openEdit(p: ThreatIntelProvider) {
  editing.value = p;
  const cfg = p.config ?? {};
  Object.assign(form, {
    name: p.name, type: p.type, enabled: p.enabled,
    apiKey: cfg.apiKey ?? "", urlTemplate: cfg.urlTemplate ?? "", headers: cfg.headers ? JSON.stringify(cfg.headers) : "",
  });
  saveError.value = null;
}
function closeEditor() {
  editing.value = undefined;
}

async function remove(p: ThreatIntelProvider) {
  if (!confirm(`Delete provider "${p.name}"?`)) return;
  await store.deleteProvider(p.id);
}

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
    if (editing.value) await store.updateProvider(editing.value.id, payload);
    else await store.createProvider(payload);
    closeEditor();
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save provider.";
  } finally {
    isSaving.value = false;
  }
}

async function runTest(p: ThreatIntelProvider) {
  testingRow.value = p.id;
  delete testResultByRow[p.id];
  try {
    const res = await store.testProvider(p.id);
    testResultByRow[p.id] = res.result?.detail || "Test succeeded.";
  } catch (err: any) {
    testResultByRow[p.id] = err?.response?.data?.detail || "Test failed.";
  } finally {
    testingRow.value = null;
  }
}

onMounted(async () => {
  if (store.providers.length === 0) await store.fetchProviders();
});
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-sm font-bold text-gray-900 dark:text-white">Threat Intel</h3>
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      Enriches IOCs (IPs, hashes, domains, URLs, emails) attached to a Case with a live lookup against one of these providers.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="!canManage()" type="info">Your role doesn't have the canEditIntegrationSecrets permission — every control below is disabled.</Alert>

    <form v-if="editing !== undefined" class="p-4 rounded-xl mb-3 space-y-3 border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800" :class="canManage() ? '' : 'opacity-60 pointer-events-none'" @submit.prevent="save">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" :disabled="!canManage()" />
      <Input :model-value="form.type" type="select" :options="TYPE_OPTIONS" label="Type" :disabled="!canManage()" @update:model-value="form.type = $event as string" />
      <p class="text-[11px] text-gray-400 -mt-2">{{ TYPE_META[form.type]?.hint }}</p>

      <template v-if="form.type === 'generic_rest'">
        <Input v-model="form.urlTemplate" label="URL template" placeholder="https://api.example.com/lookup?q={{ ioc }}" :disabled="!canManage()" />
        <Input v-model="form.headers" label="Headers (JSON, optional)" :disabled="!canManage()" />
      </template>
      <template v-else>
        <Input v-model="form.apiKey" type="password" label="API key" :disabled="!canManage()" />
      </template>

      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.enabled" :disabled="!canManage()" /> Enabled</label>

      <div class="flex items-center gap-2 pt-2">
        <Button type="submit" :loading="isSaving" :disabled="!canManage() || !form.name">{{ editing ? "Save changes" : "Add provider" }}</Button>
        <Button variant="ghost" type="button" @click="closeEditor">Cancel</Button>
      </div>
    </form>

    <div v-if="store.providers.length === 0" class="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      No threat intel providers yet.
    </div>
    <div v-else class="space-y-2">
      <div v-for="p in store.providers" :key="p.id" class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-1.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <component :is="ICONS.Radar" :size="16" weight="Linear" class="shrink-0 text-gray-400" />
            <div class="min-w-0">
              <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ p.name }}</p>
              <p class="text-[11px] text-gray-400">{{ TYPE_META[p.type]?.label ?? p.type }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: p.enabled ? '#22C55E20' : '#9CA3AF20', color: p.enabled ? '#22C55E' : '#9CA3AF' }">{{ p.enabled ? "Enabled" : "Disabled" }}</span>
            <button type="button" class="text-gray-400 hover:text-brand-600" title="Test" :disabled="!canManage() || testingRow === p.id" @click="runTest(p)"><component :is="ICONS.TestTube" :size="15" weight="Linear" /></button>
            <button type="button" class="text-gray-400 hover:text-brand-600" title="Edit" :disabled="!canManage()" @click="openEdit(p)"><component :is="ICONS.Pen" :size="15" weight="Linear" /></button>
            <button type="button" class="text-gray-400 hover:text-red-500" title="Delete" :disabled="!canManage()" @click="remove(p)"><component :is="ICONS.TrashBinTrash" :size="15" weight="Linear" /></button>
          </div>
        </div>
        <p v-if="testResultByRow[p.id]" class="text-[11px] text-gray-500 dark:text-gray-400">{{ testResultByRow[p.id] }}</p>
      </div>
    </div>

    <div v-if="editing === undefined" class="flex justify-start">
      <Button :disabled="!canManage()" @click="openNew">
        <component :is="ICONS.AddCircle" :size="15" weight="Linear" /> New Provider
      </Button>
    </div>
  </div>
</template>
