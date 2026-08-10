<script setup lang="ts">
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { useBreakpoint } from "../../composables/useBreakpoint";
import type { SoarRole } from "../../stores/roles";

defineProps<{ roles: SoarRole[]; isLoading: boolean }>();
const emit = defineEmits<{ edit: [SoarRole]; delete: [SoarRole] }>();

const { isMobile } = useBreakpoint();
</script>

<template>
  <!-- Mobile (<768px): the desktop table's 4 columns don't fit a phone
       width — one card per role instead, same pattern as DeviceFleetTable. -->
  <div v-if="isMobile" class="space-y-2">
    <div v-for="r in roles" :key="r.id" class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ r.name }}</p>
          <p class="text-xs mt-0.5 text-gray-500 dark:text-gray-400">{{ r.description || "—" }}</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" @click="emit('edit', r)">Edit</Button>
          <Button size="sm" variant="ghost" @click="emit('delete', r)">Delete</Button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1 items-center mt-2">
        <StatusPill v-for="t in r.appliveryTagValues" :key="t" :label="t" color="brand" />
        <StatusPill v-if="r.appliveryTagValues.length === 0" label="Unreachable — no tags mapped" color="red" />
      </div>
    </div>
    <EmptyState v-if="!isLoading && roles.length === 0" title="No roles" description="Create a Role to grant non-Owner collaborators access beyond the default (denied)." />
  </div>

  <div v-else class="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Description</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Mapped tag values</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in roles" :key="r.id" class="border-b border-gray-100 dark:border-gray-800 last:border-0">
          <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ r.name }}</td>
          <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ r.description || "—" }}</td>
          <td class="px-4 py-3">
            <div class="flex flex-wrap gap-1 items-center">
              <StatusPill v-for="t in r.appliveryTagValues" :key="t" :label="t" color="brand" />
              <StatusPill v-if="r.appliveryTagValues.length === 0" label="Unreachable — no tags mapped" color="red" />
            </div>
          </td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="ghost" @click="emit('edit', r)">Edit</Button>
            <Button size="sm" variant="ghost" @click="emit('delete', r)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && roles.length === 0" title="No roles" description="Create a Role to grant non-Owner collaborators access beyond the default (denied)." />
  </div>
</template>
