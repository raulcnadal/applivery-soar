<script setup lang="ts">
// Inbound Webhooks (Triggers) Settings tab. Port of TriggersSettings.jsx
// (wow-dashboard/src/components/settings/TriggersSettings.jsx).
//
// Deliberately NOT a Modal — same inline-form-above-card-list swap as the
// other 4 converted panels. Replaces the former TriggersTable.vue +
// TriggerDialog.vue pair.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useTriggersStore, type Trigger } from "../../stores/triggers";
import { useWorkflowsStore } from "../../stores/workflows";

const store = useTriggersStore();
const workflowsStore = useWorkflowsStore();

function blankForm() {
  return { name: "", description: "", workflowId: "", enabled: true, openCase: false, caseSeverity: "medium", deviceLookupField: "" };
}
const editing = ref<Trigger | null | undefined>(undefined);
const form = reactive(blankForm());
const isSaving = ref(false);
const saveError = ref<string | null>(null);

function openNew() {
  editing.value = null;
  Object.assign(form, blankForm());
  saveError.value = null;
}
function openEdit(t: Trigger) {
  editing.value = t;
  Object.assign(form, {
    name: t.name, description: t.description ?? "", workflowId: t.workflowId, enabled: t.enabled,
    openCase: t.openCase, caseSeverity: t.caseSeverity, deviceLookupField: t.deviceLookupField ?? "",
  });
  saveError.value = null;
}
function closeEditor() {
  editing.value = undefined;
}

async function remove(t: Trigger) {
  if (!confirm(`Delete trigger "${t.name}"? Its URL stops working immediately.`)) return;
  await store.deleteTrigger(t.id);
}

async function rotate(t: Trigger) {
  if (!confirm(`Rotate the secret for "${t.name}"? The old URL stops working immediately.`)) return;
  await store.rotateSecret(t.id);
}

async function copyUrl(t: Trigger, kind: "fire" | "resolve") {
  try {
    await navigator.clipboard.writeText(kind === "fire" ? store.fireUrl(t) : store.resolveUrl(t));
  } catch {
    /* clipboard API unavailable — no-op */
  }
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = { ...form, deviceLookupField: form.deviceLookupField || null };
    if (editing.value) await store.updateTrigger(editing.value.id, payload);
    else await store.createTrigger(payload);
    closeEditor();
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save trigger.";
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  if (workflowsStore.workflows.length === 0) await workflowsStore.fetchWorkflows();
  if (store.triggers.length === 0) await store.fetchTriggers();
});
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-sm font-bold text-gray-900 dark:text-white">Inbound Webhooks</h3>
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      Lets an external system (EDR, firewall, SIEM, IDS — anything that can POST JSON to a URL) fire a specific Workflow
      directly, no Compliance Policy required. Each trigger gets its own self-contained URL — id and secret both live in the
      path, the same pattern Slack/Teams/PagerDuty use for their own incoming webhooks — so pasting it into any of those
      tools is enough.
    </p>
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      With a Device lookup field set, a trigger can also feed a Compliance Policy's <strong>Inbound Webhook Fired</strong>
      condition — the second, <strong>Resolved</strong> URL below the Fire URL is how the same external system reports that
      condition cleared, so a device it moved out of compliance can actually recover instead of staying flagged forever.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <form v-if="editing !== undefined" class="p-4 rounded-xl mb-3 space-y-3 border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800" @submit.prevent="save">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" />
      <Input v-model="form.description" label="Description (optional)" />
      <Input :model-value="form.workflowId" type="select" :options="workflowsStore.workflows.map((w) => ({ value: w.id, label: w.name }))" label="Workflow to run" @update:model-value="form.workflowId = $event as string" />
      <Input v-model="form.deviceLookupField" label="Device lookup field (optional)" placeholder="e.g. serialNumber — matched against the inbound JSON body's same-named key" />
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.enabled" /> Enabled</label>
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.openCase" /> Open a Case when this trigger fires</label>
      <Input v-if="form.openCase" :model-value="form.caseSeverity" type="select" :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))" label="Case severity" @update:model-value="form.caseSeverity = $event as string" />

      <div class="flex items-center gap-2 pt-2">
        <Button type="submit" :loading="isSaving" :disabled="!form.name || !form.workflowId">{{ editing ? "Save changes" : "Create trigger" }}</Button>
        <Button variant="ghost" type="button" @click="closeEditor">Cancel</Button>
      </div>
    </form>

    <div v-if="store.triggers.length === 0" class="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      No triggers yet.
    </div>
    <div v-else class="space-y-2">
      <div v-for="t in store.triggers" :key="t.id" class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-1.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <component :is="ICONS.Bolt" :size="16" weight="Linear" class="shrink-0 text-gray-400" />
            <div class="min-w-0">
              <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ t.name }}</p>
              <p v-if="t.description" class="text-[11px] text-gray-400 truncate">{{ t.description }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: t.enabled ? '#22C55E20' : '#9CA3AF20', color: t.enabled ? '#22C55E' : '#9CA3AF' }">{{ t.enabled ? "Enabled" : "Disabled" }}</span>
            <span v-if="t.openCase" class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background-color: #0055ff20; color: #0055ff">Opens Case</span>
            <button type="button" class="text-gray-400 hover:text-brand-600" title="Rotate secret" @click="rotate(t)"><component :is="ICONS.RefreshCircle" :size="15" weight="Linear" /></button>
            <button type="button" class="text-gray-400 hover:text-brand-600" title="Edit" @click="openEdit(t)"><component :is="ICONS.Pen" :size="15" weight="Linear" /></button>
            <button type="button" class="text-gray-400 hover:text-red-500" title="Delete" @click="remove(t)"><component :is="ICONS.TrashBinTrash" :size="15" weight="Linear" /></button>
          </div>
        </div>
        <p class="text-[11px] text-gray-400">{{ t.deviceLookupField ? `Device lookup: ${t.deviceLookupField}` : "Device-less" }} — {{ t.fireCount }}x fired{{ t.lastFiredAt ? ` (last ${new Date(t.lastFiredAt).toLocaleString()})` : "" }}</p>
        <div class="flex items-center gap-1.5">
          <span class="text-[9px] font-semibold uppercase tracking-wide text-gray-400 w-12 shrink-0">Fire</span>
          <code class="text-[10px] text-gray-500 dark:text-gray-400 truncate bg-gray-50 dark:bg-black/20 rounded px-1.5 py-0.5 flex-1">{{ store.fireUrl(t) }}</code>
          <button type="button" class="text-gray-400 hover:text-brand-600 shrink-0" title="Copy Fire URL" @click="copyUrl(t, 'fire')"><component :is="ICONS.Copy" :size="13" weight="Linear" /></button>
        </div>
        <div v-if="t.deviceLookupField" class="flex items-center gap-1.5">
          <span class="text-[9px] font-semibold uppercase tracking-wide text-gray-400 w-12 shrink-0">Resolve</span>
          <code class="text-[10px] text-gray-500 dark:text-gray-400 truncate bg-gray-50 dark:bg-black/20 rounded px-1.5 py-0.5 flex-1">{{ store.resolveUrl(t) }}</code>
          <button type="button" class="text-gray-400 hover:text-brand-600 shrink-0" title="Copy Resolved URL" @click="copyUrl(t, 'resolve')"><component :is="ICONS.Copy" :size="13" weight="Linear" /></button>
        </div>
        <p v-else class="text-[10px] text-gray-400">Set a Device lookup field to also get a Resolved URL, so this trigger can back a Compliance Policy condition.</p>
      </div>
    </div>

    <p v-if="editing === undefined && workflowsStore.workflows.length === 0" class="text-xs text-gray-400">Create a Workflow first.</p>
    <div v-if="editing === undefined" class="flex justify-start">
      <Button :disabled="workflowsStore.workflows.length === 0" @click="openNew">
        <component :is="ICONS.AddCircle" :size="15" weight="Linear" /> New Trigger
      </Button>
    </div>
  </div>
</template>
