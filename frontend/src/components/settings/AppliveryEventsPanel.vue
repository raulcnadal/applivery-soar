<script setup lang="ts">
// Applivery Events tab. Port of main.py:13036-13096 (config CRUD). The
// receiver that actually fires these rules is TODO(Phase8) — see
// appliveryWebhookSettings.service.ts's module comment; rules saved here
// won't run anything yet, but the tab is fully editable/functional.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useAppliveryWebhookSettingsStore } from "../../stores/appliveryWebhookSettings";
import { useWorkflowsStore } from "../../stores/workflows";

const store = useAppliveryWebhookSettingsStore();
const workflowsStore = useWorkflowsStore();

const enabled = ref(true);
const rules = reactive<Array<{
  id?: string; actionKey: string; label: string | null; enabled: boolean; openCase: boolean;
  caseSeverity: string; runWorkflow: boolean; workflowId: string | null; autoRunDestructiveAck: boolean;
}>>([]);
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const busy = ref(false);

const workflowOptions = computed(() => workflowsStore.workflows.map((w) => ({ value: w.id, label: w.name })));

watch(() => store.config, (cfg) => {
  if (!cfg) return;
  enabled.value = cfg.enabled;
  rules.splice(0, rules.length, ...cfg.rules.map((r) => ({ ...r })));
}, { immediate: true });

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    await store.saveConfig(enabled.value, rules);
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save Applivery event webhook settings.";
  } finally {
    isSaving.value = false;
  }
}

async function rotateSecret() {
  busy.value = true;
  try { await store.rotateSecret(); } finally { busy.value = false; }
}

onMounted(async () => {
  await Promise.all([store.fetchConfig(), workflowsStore.fetchWorkflows()]);
});
</script>

<template>
  <div class="space-y-4">
    <p class="text-[11px] leading-relaxed text-gray-500">
      Lets Applivery push its own events (device enrolled, build processed, certificate expiring…) into this app — open a Case and/or run a Workflow automatically. The inbound receiver ships in a later phase; this tab lets you review and pre-configure rules now.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>

    <div v-if="store.config" class="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
      <div class="flex items-center justify-between">
        <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" v-model="enabled" /> Webhook enabled</label>
        <Button size="sm" variant="ghost" :loading="busy" @click="rotateSecret">Rotate secret</Button>
      </div>
      <div>
        <label class="block text-[10px] font-medium mb-1 text-gray-500">Webhook secret (paste into Applivery's Integrations settings)</label>
        <code class="block px-2.5 py-2 rounded-lg text-[11px] font-mono border border-gray-200 bg-gray-50 break-all">{{ store.config.secret }}</code>
      </div>
    </div>

    <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Event</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Enabled</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Open case</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Case severity</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Run workflow</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Workflow</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rules" :key="r.actionKey" class="border-b border-gray-100 last:border-0">
            <td class="px-4 py-3 font-medium text-gray-900">{{ r.label || r.actionKey }}</td>
            <td class="px-4 py-3"><input type="checkbox" v-model="r.enabled" /></td>
            <td class="px-4 py-3"><input type="checkbox" v-model="r.openCase" /></td>
            <td class="px-4 py-3">
              <select v-model="r.caseSeverity" class="rounded-lg px-2 py-1.5 text-xs border border-gray-200">
                <option v-for="s in ['low', 'medium', 'high', 'critical']" :key="s" :value="s">{{ s }}</option>
              </select>
            </td>
            <td class="px-4 py-3"><input type="checkbox" v-model="r.runWorkflow" /></td>
            <td class="px-4 py-3 min-w-[180px]">
              <Input
                v-if="r.runWorkflow"
                :model-value="r.workflowId ?? ''" type="select"
                :options="[{ value: '', label: 'Select workflow…' }, ...workflowOptions]"
                @update:model-value="r.workflowId = ($event as string) || null"
              />
              <span v-else class="text-gray-400">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex justify-end">
      <Button :loading="isSaving" @click="save">Save rules</Button>
    </div>
  </div>
</template>
