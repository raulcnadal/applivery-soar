<script setup lang="ts">
// Inbound webhook Triggers — self-contained URLs external systems can POST
// to in order to fire a workflow unattended. Port of main.py:12660-12901.
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { useTriggersStore, type Trigger } from "../../stores/triggers";

defineProps<{ triggers: Trigger[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [trigger: Trigger] }>();

const store = useTriggersStore();

async function remove(trigger: Trigger) {
  if (!confirm(`Delete trigger "${trigger.name}"? Its URL stops working immediately.`)) return;
  await store.deleteTrigger(trigger.id);
}

async function rotate(trigger: Trigger) {
  if (!confirm(`Rotate the secret for "${trigger.name}"? The old URL stops working immediately.`)) return;
  await store.rotateSecret(trigger.id);
}

async function copyUrl(trigger: Trigger) {
  try {
    await navigator.clipboard.writeText(store.fireUrl(trigger));
  } catch {
    /* clipboard API unavailable — no-op */
  }
}
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Device lookup</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Fired</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Webhook URL</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in triggers" :key="t.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3">
            <p class="font-medium text-gray-900">{{ t.name }}</p>
            <p v-if="t.description" class="text-xs text-gray-400">{{ t.description }}</p>
          </td>
          <td class="px-4 py-3"><StatusPill :label="t.enabled ? 'Enabled' : 'Disabled'" :color="t.enabled ? 'green' : 'gray'" /></td>
          <td class="px-4 py-3 text-gray-600 text-xs">{{ t.deviceLookupField || "None (device-less)" }}</td>
          <td class="px-4 py-3 text-gray-500 text-xs">
            {{ t.fireCount }}x<span v-if="t.lastFiredAt"> — last {{ new Date(t.lastFiredAt).toLocaleString() }}</span>
          </td>
          <td class="px-4 py-3">
            <button type="button" class="text-xs text-brand-600 hover:underline truncate max-w-[220px] inline-block align-bottom" @click="copyUrl(t)" title="Click to copy">
              {{ store.fireUrl(t) }}
            </button>
          </td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="ghost" @click="rotate(t)">Rotate secret</Button>
            <Button size="sm" variant="secondary" @click="emit('edit', t)">Edit</Button>
            <Button size="sm" variant="ghost" @click="remove(t)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && triggers.length === 0" title="No triggers yet" description="Create an inbound webhook URL an external EDR/SIEM/ticketing tool can POST to, to fire a workflow unattended." />
  </div>
</template>
