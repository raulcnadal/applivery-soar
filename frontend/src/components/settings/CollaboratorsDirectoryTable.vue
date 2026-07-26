<script setup lang="ts">
// "Collaborators & Tags" sub-view (docs/settings.md#roles). Raw pass-through
// of Applivery's own collaborator objects, so field names are read
// defensively (id/_id, email/user.email, fullName/name).
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import type { Collaborator } from "../../stores/roles";

defineProps<{ collaborators: Collaborator[]; isLoading: boolean }>();
const emit = defineEmits<{ edit: [Collaborator]; testAccess: [Collaborator] }>();

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
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Email</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Applivery role</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Detected tags</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in collaborators" :key="idOf(c)" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3 font-medium text-gray-900">{{ nameOf(c) }}</td>
          <td class="px-4 py-3 text-gray-500">{{ emailOf(c) }}</td>
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
