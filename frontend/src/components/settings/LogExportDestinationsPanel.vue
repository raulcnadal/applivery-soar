<script setup lang="ts">
// Log Export Destinations tab. Port of main.py:2260-2270's Settings panel.
import { Alert, Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { useLogExportDestinationsStore, type LogExportDestination } from "../../stores/logExportDestinations";
import LogExportDestinationDialog from "./LogExportDestinationDialog.vue";

const store = useLogExportDestinationsStore();
const dialogOpen = ref(false);
const editing = ref<LogExportDestination | null>(null);
const testResult = ref<string | null>(null);

function openNew() { editing.value = null; dialogOpen.value = true; }
function openEdit(d: LogExportDestination) { editing.value = d; dialogOpen.value = true; }
async function remove(d: LogExportDestination) { await store.deleteDestination(d.id); }
async function test(d: LogExportDestination) {
  testResult.value = null;
  try {
    await store.testDestination(d.id);
    testResult.value = `Test event sent to "${d.name}".`;
  } catch (err: any) {
    testResult.value = err?.response?.data?.detail || `Test failed for "${d.name}".`;
  }
}

onMounted(async () => {
  await store.fetchDestinations();
});
</script>

<template>
  <div class="space-y-4">
    <p class="text-[11px] leading-relaxed text-gray-500">
      Ships this workspace's audit trail somewhere outside the app. Syslog and webhook deliver in real time as events happen; S3, NFS, and SFTP export once a day.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="testResult" type="info">{{ testResult }}</Alert>

    <div class="flex justify-end">
      <Button @click="openNew">New destination</Button>
    </div>

    <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Type</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Format</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Last export</th>
            <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in store.destinations" :key="d.id" class="border-b border-gray-100 last:border-0">
            <td class="px-4 py-3 font-medium text-gray-900">{{ d.name }}</td>
            <td class="px-4 py-3 text-gray-700 uppercase text-xs">{{ d.type }}</td>
            <td class="px-4 py-3 text-gray-500 uppercase text-xs">{{ d.format }}</td>
            <td class="px-4 py-3">
              <StatusPill v-if="d.lastExportError" label="Error" color="red" />
              <StatusPill v-else :label="d.enabled ? 'Enabled' : 'Disabled'" :color="d.enabled ? 'green' : 'gray'" />
            </td>
            <td class="px-4 py-3 text-gray-500">{{ d.lastExportedAt ? new Date(d.lastExportedAt).toLocaleString() : "—" }}</td>
            <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
              <Button size="sm" variant="ghost" @click="test(d)">Test</Button>
              <Button size="sm" variant="ghost" @click="openEdit(d)">Edit</Button>
              <Button size="sm" variant="ghost" @click="remove(d)">Delete</Button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!store.isLoading && store.destinations.length === 0" title="No log export destinations" description="Ship this workspace's audit trail to a SIEM, bucket, or mounted share." />
    </div>

    <LogExportDestinationDialog :open="dialogOpen" :destination="editing" @close="dialogOpen = false" @saved="store.fetchDestinations()" />
  </div>
</template>
