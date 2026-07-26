<script setup lang="ts">
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import type { CaseAutoRunRule } from "../../stores/cases";

defineProps<{ rules: CaseAutoRunRule[]; isLoading: boolean }>();
const emit = defineEmits<{ edit: [CaseAutoRunRule]; delete: [CaseAutoRunRule] }>();
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Min severity</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Rate cap</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rules" :key="r.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3 font-medium text-gray-900">{{ r.name }}</td>
          <td class="px-4 py-3 text-gray-700">{{ r.minSeverity }}</td>
          <td class="px-4 py-3"><StatusPill :label="r.enabled ? 'Enabled' : 'Disabled'" :color="r.enabled ? 'green' : 'gray'" /></td>
          <td class="px-4 py-3 text-gray-500">{{ r.maxFiresPerHour }}/hour</td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="ghost" @click="emit('edit', r)">Edit</Button>
            <Button size="sm" variant="ghost" @click="emit('delete', r)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && rules.length === 0" title="No Case Auto-Run rules" description="Automatically run a workflow the moment a manually-created Case matches your criteria." />
  </div>
</template>
