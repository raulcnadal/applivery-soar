<script setup lang="ts">
// Applivery Events tab. Port of main.py:13036-13243 (config CRUD + the
// recent-events feed the receiver, appliveryWebhookReceive.service.ts,
// populates).
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useAppliveryWebhookSettingsStore } from "../../stores/appliveryWebhookSettings";
import { useWorkflowsStore } from "../../stores/workflows";

const OUTCOME_COLORS: Record<string, string> = {
  logged: "#9CA3AF", webhook_disabled: "#9CA3AF", case_opened: "#0241E3", workflow_fired: "#22C55E",
  workflow_blocked_destructive: "#EF4444", workflow_missing: "#F59E0B", no_automation_credential: "#F59E0B",
  workflow_unavailable: "#F59E0B",
};
function outcomeColor(outcome: string): string {
  return OUTCOME_COLORS[outcome] ?? "#0241E3";
}
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      Lets Applivery push its own events (device enrolled, build processed, certificate expiring…) into this app — open a Case and/or run a Workflow automatically. The inbound receiver ships in a later phase; this tab lets you review and pre-configure rules now.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>

    <div v-if="store.config" class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3">
      <div class="flex items-center justify-between">
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="enabled" /> Webhook enabled</label>
        <Button size="sm" variant="ghost" :loading="busy" @click="rotateSecret">Rotate secret</Button>
      </div>
      <div>
        <label class="block text-[10px] font-medium mb-1 text-gray-500 dark:text-gray-400">Webhook secret (paste into Applivery's Integrations settings)</label>
        <code class="block px-2.5 py-2 rounded-lg text-[11px] font-mono border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 break-all">{{ store.config.secret }}</code>
      </div>
    </div>

    <div class="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Event</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Enabled</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Open case</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Case severity</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Run workflow</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Workflow</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rules" :key="r.actionKey" class="border-b border-gray-100 dark:border-gray-800 last:border-0">
            <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ r.label || r.actionKey }}</td>
            <td class="px-4 py-3"><input type="checkbox" v-model="r.enabled" /></td>
            <td class="px-4 py-3"><input type="checkbox" v-model="r.openCase" /></td>
            <td class="px-4 py-3">
              <select v-model="r.caseSeverity" class="rounded-lg px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700">
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

    <div v-if="store.config && store.config.recentEvents.length > 0">
      <h4 class="text-xs font-semibold mb-2 text-gray-900 dark:text-white">Recent events</h4>
      <div class="space-y-1.5">
        <div
          v-for="ev in store.config.recentEvents.slice(0, 15)"
          :key="ev.id"
          class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[11px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        >
          <div class="min-w-0 flex items-center gap-2">
            <span class="font-medium truncate text-gray-900 dark:text-white">{{ ev.actionKey }}</span>
            <span v-if="ev.deviceName" class="truncate text-gray-500 dark:text-gray-400">· {{ ev.deviceName }}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span
              class="font-semibold px-1.5 py-0.5 rounded-full"
              :style="{ backgroundColor: `${outcomeColor(ev.outcome)}15`, color: outcomeColor(ev.outcome) }"
            >
              {{ ev.outcome.replace(/_/g, " ") }}
            </span>
            <span class="text-gray-500 dark:text-gray-400">{{ timeAgo(ev.receivedAt) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
