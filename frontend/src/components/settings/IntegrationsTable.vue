<script setup lang="ts">
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import type { Integration } from "../../stores/integrations";

defineProps<{ integrations: Integration[]; isLoading: boolean }>();
const emit = defineEmits<{ edit: [Integration]; delete: [Integration] }>();
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Type</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Last fired</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="i in integrations" :key="i.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3 font-medium text-gray-900">{{ i.name }}</td>
          <td class="px-4 py-3 text-gray-700">{{ i.type }}</td>
          <td class="px-4 py-3">
            <StatusPill :label="i.enabled ? 'Enabled' : 'Disabled'" :color="i.enabled ? 'green' : 'gray'" />
            <StatusPill v-if="i.lastError" label="Error" color="red" class="ml-1" />
          </td>
          <td class="px-4 py-3 text-gray-500">{{ i.lastFiredAt ? new Date(i.lastFiredAt).toLocaleString() : "Never" }} ({{ i.fireCount }})</td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="ghost" @click="emit('edit', i)">Edit</Button>
            <Button size="sm" variant="ghost" @click="emit('delete', i)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && integrations.length === 0" title="No integrations" description="Connect Slack, Teams, Jira, PagerDuty, and more to notify on Case activity." />
  </div>
</template>
