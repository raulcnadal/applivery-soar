<script setup lang="ts">
// "Collaborators & Tags" sub-view (docs/settings.md#roles). Raw pass-through
// of Applivery's own collaborator objects, so field names are read
// defensively (id/_id, email/user.email, fullName/name).
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { useBreakpoint } from "../../composables/useBreakpoint";
import type { Collaborator } from "../../stores/roles";

defineProps<{ collaborators: Collaborator[]; isLoading: boolean }>();
const emit = defineEmits<{ edit: [Collaborator]; testAccess: [Collaborator] }>();

const { isMobile } = useBreakpoint();

function idOf(c: Collaborator): string {
  return String(c.id ?? c._id ?? "");
}
function emailOf(c: Collaborator): string {
  return String(c.email ?? (c as any).user?.email ?? "");
}
function nameOf(c: Collaborator): string {
  return String(c.fullName ?? c.name ?? (c as any).user?.fullName ?? emailOf(c));
}
</script>

<template>
  <div v-if="isMobile" class="space-y-2">
    <div v-for="c in collaborators" :key="idOf(c)" class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ nameOf(c) }}</p>
          <p class="text-xs mt-0.5 truncate text-gray-500 dark:text-gray-400">{{ emailOf(c) }}</p>
        </div>
        <StatusPill :label="c.role_normalized || 'unassigned'" :color="c.role_normalized === 'owner' ? 'green' : 'gray'" class="shrink-0" />
      </div>
      <div class="flex flex-wrap gap-1 mt-2">
        <StatusPill v-for="t in c.tagCandidates ?? []" :key="t" :label="t" color="brand" />
        <span v-if="!(c.tagCandidates ?? []).length" class="text-gray-400 text-xs">no tags detected</span>
      </div>
      <div class="flex items-center gap-2 mt-2">
        <Button size="sm" variant="ghost" @click="emit('testAccess', c)">Test access</Button>
        <Button size="sm" variant="ghost" @click="emit('edit', c)">Edit</Button>
      </div>
    </div>
    <EmptyState v-if="!isLoading && collaborators.length === 0" title="No collaborators found" description="Collaborators are managed in Applivery's own console; this lists whoever the signed-in session can see." />
  </div>

  <div v-else class="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Email</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Applivery role</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Detected tags</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in collaborators" :key="idOf(c)" class="border-b border-gray-100 dark:border-gray-800 last:border-0">
          <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ nameOf(c) }}</td>
          <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ emailOf(c) }}</td>
          <td class="px-4 py-3">
            <StatusPill :label="c.role_normalized || 'unassigned'" :color="c.role_normalized === 'owner' ? 'green' : 'gray'" />
          </td>
          <td class="px-4 py-3">
            <div class="flex flex-wrap gap-1">
              <StatusPill v-for="t in c.tagCandidates ?? []" :key="t" :label="t" color="brand" />
              <span v-if="!(c.tagCandidates ?? []).length" class="text-gray-400 text-xs">none</span>
            </div>
          </td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="ghost" @click="emit('testAccess', c)">Test access</Button>
            <Button size="sm" variant="ghost" @click="emit('edit', c)">Edit</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && collaborators.length === 0" title="No collaborators found" description="Collaborators are managed in Applivery's own console; this lists whoever the signed-in session can see." />
  </div>
</template>
