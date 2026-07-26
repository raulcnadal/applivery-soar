<script setup lang="ts">
// "Apple App Updates" tab (docs/settings.md#apple-app-updates) —
// status/monitoring only. Refresh here queues a background refresh rather
// than running synchronously, since it's rate-limited and shared with the
// App List inventory refresher.
import { Alert, Button, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { useCatalogsStore } from "../../stores/catalogs";

const store = useCatalogsStore();
const queuedMessage = ref<string | null>(null);

onMounted(async () => {
  if (!store.appleAppUpdatesStatus) await store.fetchAppleAppUpdatesStatus();
});

async function refresh() {
  queuedMessage.value = null;
  const res = await store.refreshAppleAppUpdates();
  queuedMessage.value = res.queued > 0 ? `Queued a refresh for ${res.queued} device(s) — check back in a minute.` : "Nothing to refresh.";
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs text-gray-400 max-w-2xl">
      Tracks pending app updates for Apple/macOS devices, sourced directly from Applivery's own per-device
      HasUpdateAvailable field — exact, not a version comparison this app computes itself. Apple-only.
    </p>

    <div v-if="store.appleAppUpdatesStatus" class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl">
      <div class="border border-gray-200 rounded-xl bg-white p-4">
        <p class="text-xs text-gray-500">Devices with pending updates</p>
        <p class="text-2xl font-semibold text-gray-900">{{ store.appleAppUpdatesStatus.devicesWithPendingUpdates }}</p>
      </div>
      <div class="border border-gray-200 rounded-xl bg-white p-4">
        <p class="text-xs text-gray-500">Pending app instances</p>
        <p class="text-2xl font-semibold text-gray-900">{{ store.appleAppUpdatesStatus.totalPendingAppInstances }}</p>
      </div>
      <div class="border border-gray-200 rounded-xl bg-white p-4">
        <p class="text-xs text-gray-500">Synced / never synced</p>
        <p class="text-2xl font-semibold text-gray-900">{{ store.appleAppUpdatesStatus.syncedCount }} / {{ store.appleAppUpdatesStatus.neverSyncedCount }}</p>
      </div>
      <div class="border border-gray-200 rounded-xl bg-white p-4">
        <p class="text-xs text-gray-500">Est. full-cycle time</p>
        <p class="text-2xl font-semibold text-gray-900">{{ store.appleAppUpdatesStatus.estimatedFullCycleHours }}h</p>
      </div>
    </div>

    <div v-if="store.appleAppUpdatesStatus?.topPendingApps.length">
      <p class="text-xs font-medium text-gray-500 mb-1">Most common apps with an update available</p>
      <div class="flex flex-wrap gap-1">
        <StatusPill v-for="a in store.appleAppUpdatesStatus.topPendingApps" :key="a.name" :label="`${a.name} (${a.deviceCount})`" color="brand" />
      </div>
    </div>

    <Alert v-if="queuedMessage" type="success">{{ queuedMessage }}</Alert>
    <Button variant="ghost" :loading="store.isRefreshing" @click="refresh">Refresh now</Button>
  </div>
</template>
