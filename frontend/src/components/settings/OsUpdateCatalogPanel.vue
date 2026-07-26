<script setup lang="ts">
// "OS Updates" tab (docs/settings.md#os-updates) — status/monitoring only.
import { Alert, Button } from "@applivery/bluesky-vue";
import { computed, onMounted } from "vue";
import { useCatalogsStore } from "../../stores/catalogs";

const store = useCatalogsStore();

onMounted(async () => {
  if (!store.osUpdateCatalog) await store.fetchOsUpdateCatalog();
});

const entryCount = computed(() => store.osUpdateCatalog?.kbEntries.length ?? 0);
const monthCount = computed(() => store.osUpdateCatalog?.monthsFetched.length ?? 0);
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs text-gray-400 max-w-2xl">
      A rolling catalog of Microsoft's monthly Windows security updates (from MSRC's public feed, refreshed daily), matched
      against each Windows device's reported build to show a patch-gap count. Security Updates only.
    </p>
    <Alert v-if="store.osUpdateCatalog?.lastError" type="danger">{{ store.osUpdateCatalog.lastError }}</Alert>

    <div class="grid grid-cols-3 gap-4 max-w-xl">
      <div class="border border-gray-200 rounded-xl bg-white p-4">
        <p class="text-xs text-gray-500">KB entries</p>
        <p class="text-2xl font-semibold text-gray-900">{{ entryCount }}</p>
      </div>
      <div class="border border-gray-200 rounded-xl bg-white p-4">
        <p class="text-xs text-gray-500">Months fetched</p>
        <p class="text-2xl font-semibold text-gray-900">{{ monthCount }}</p>
      </div>
      <div class="border border-gray-200 rounded-xl bg-white p-4">
        <p class="text-xs text-gray-500">Last fetched</p>
        <p class="text-sm font-medium text-gray-900 mt-1">{{ store.osUpdateCatalog?.lastFetchedAt ? new Date(store.osUpdateCatalog.lastFetchedAt).toLocaleString() : "Never" }}</p>
      </div>
    </div>

    <Button variant="ghost" :loading="store.isRefreshing" @click="store.refreshOsUpdateCatalog()">Refresh now</Button>
  </div>
</template>
