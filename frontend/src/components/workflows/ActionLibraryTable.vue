<script setup lang="ts">
// Script & OMA-URI Library — list, edit, delete. Port of the original app's
// Action Library table (main.py:4894-5023).
import { Button, EmptyState } from "@applivery/bluesky-vue";
import { useActionLibraryStore, type ActionLibraryEntry } from "../../stores/actionLibrary";

defineProps<{ entries: ActionLibraryEntry[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [entry: ActionLibraryEntry] }>();

const store = useActionLibraryStore();

async function remove(entry: ActionLibraryEntry) {
  if (!confirm(`Remove "${entry.name}" from the library?`)) return;
  await store.deleteEntry(entry.id);
}
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Type</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Platform</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Detail</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Updated</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in entries" :key="e.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3">
            <p class="font-medium text-gray-900">{{ e.name }}</p>
            <p v-if="e.description" class="text-xs text-gray-400">{{ e.description }}</p>
          </td>
          <td class="px-4 py-3">
            <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{{ e.type === "script" ? "Script" : "OMA-URI" }}</span>
          </td>
          <td class="px-4 py-3 text-gray-600">{{ e.platform }}</td>
          <td class="px-4 py-3 text-gray-500 text-xs">
            <span v-if="e.type === 'script'">{{ e.assetName || e.assetId }}</span>
            <span v-else>{{ e.path }} ({{ e.format }})</span>
          </td>
          <td class="px-4 py-3 text-gray-500">{{ new Date(e.updatedAt).toLocaleString() }}</td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="secondary" @click="emit('edit', e)">Edit</Button>
            <Button size="sm" variant="ghost" @click="remove(e)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && entries.length === 0" title="Library is empty" description="Add a script pointer or an OMA-URI command, or fetch existing scripts from Applivery." />
  </div>
</template>
