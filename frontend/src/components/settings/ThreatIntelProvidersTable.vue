<script setup lang="ts">
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import type { ThreatIntelProvider } from "../../stores/threatIntel";

defineProps<{ providers: ThreatIntelProvider[]; isLoading: boolean }>();
const emit = defineEmits<{ edit: [ThreatIntelProvider]; delete: [ThreatIntelProvider] }>();
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Type</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in providers" :key="p.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3 font-medium text-gray-900">{{ p.name }}</td>
          <td class="px-4 py-3 text-gray-700">{{ p.type }}</td>
          <td class="px-4 py-3"><StatusPill :label="p.enabled ? 'Enabled' : 'Disabled'" :color="p.enabled ? 'green' : 'gray'" /></td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="ghost" @click="emit('edit', p)">Edit</Button>
            <Button size="sm" variant="ghost" @click="emit('delete', p)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && providers.length === 0" title="No threat intel providers" description="Add VirusTotal, AbuseIPDB, HIBP, or a generic REST lookup to enrich Case IOCs." />
  </div>
</template>
