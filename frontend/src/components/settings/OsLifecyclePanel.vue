<script setup lang="ts">
// "OS Lifecycle" tab (docs/settings.md#os-lifecycle) — status/monitoring
// only, two independent sources each with its own Refresh now: the
// lifecycle catalog (endoflife.date) and Apple GDMF.
import { Alert, Button } from "@applivery/bluesky-vue";
import { computed, onMounted } from "vue";
import { useCatalogsStore } from "../../stores/catalogs";

const store = useCatalogsStore();

onMounted(async () => {
  if (!store.osLifecycleCatalog) await store.fetchOsLifecycleCatalog();
  if (!store.gdmfCatalog) await store.fetchGdmfCatalog();
});

const lifecyclePlatformCounts = computed(() => {
  const platforms = store.osLifecycleCatalog?.platforms ?? {};
  return Object.entries(platforms).map(([platform, entries]) => ({ platform, count: entries.length }));
});
const gdmfPlatformCounts = computed(() => {
  const platforms = store.gdmfCatalog?.platforms ?? {};
  return Object.entries(platforms).map(([platform, entries]) => ({ platform, count: entries.length }));
});
const gdmfRsrCount = computed(() => {
  const rsr = store.gdmfCatalog?.rapidSecurityResponses ?? {};
  return Object.values(rsr).reduce((sum, arr) => sum + arr.length, 0);
});
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-3">
      <p class="text-sm font-medium text-gray-700">Lifecycle catalog</p>
      <p class="text-xs text-gray-400 max-w-2xl">
        End-of-life/active-support status for Windows, iOS/iPadOS, macOS, and Android versions (from endoflife.date,
        refreshed weekly). Windows editions with different support windows are conservatively flagged end-of-life only
        once every edition sharing that build has lapsed.
      </p>
      <Alert v-if="store.osLifecycleCatalog?.lastError" type="danger">{{ store.osLifecycleCatalog.lastError }}</Alert>
      <div class="flex flex-wrap gap-3">
        <div v-for="p in lifecyclePlatformCounts" :key="p.platform" class="border border-gray-200 rounded-xl bg-white px-4 py-2">
          <p class="text-xs text-gray-500">{{ p.platform }}</p>
          <p class="text-lg font-semibold text-gray-900">{{ p.count }}</p>
        </div>
      </div>
      <p class="text-xs text-gray-500">Last fetched: {{ store.osLifecycleCatalog?.lastFetchedAt ? new Date(store.osLifecycleCatalog.lastFetchedAt).toLocaleString() : "Never" }}</p>
      <Button variant="ghost" :loading="store.isRefreshing" @click="store.refreshOsLifecycleCatalog()">Refresh now</Button>
    </div>

    <div class="space-y-3 pt-4 border-t border-gray-100">
      <p class="text-sm font-medium text-gray-700">Apple GDMF (Software Lookup Service)</p>
      <p class="text-xs text-gray-400 max-w-2xl">
        The source Apple's own Declarative Device Management now expects UEMs to use for exact build numbers and
        signing-expiration dates, refreshed daily. When a device's exact hardware model can be confirmed, "latest available"
        reflects that specific hardware; otherwise it falls back to the newest still-signed release fleet-wide, labeled
        "unconfirmed." Active Rapid Security Responses are listed separately.
      </p>
      <Alert v-if="store.gdmfCatalog?.lastError" type="danger">{{ store.gdmfCatalog.lastError }}</Alert>
      <div class="flex flex-wrap gap-3">
        <div v-for="p in gdmfPlatformCounts" :key="p.platform" class="border border-gray-200 rounded-xl bg-white px-4 py-2">
          <p class="text-xs text-gray-500">{{ p.platform }}</p>
          <p class="text-lg font-semibold text-gray-900">{{ p.count }}</p>
        </div>
        <div class="border border-gray-200 rounded-xl bg-white px-4 py-2">
          <p class="text-xs text-gray-500">Active Rapid Security Responses</p>
          <p class="text-lg font-semibold text-gray-900">{{ gdmfRsrCount }}</p>
        </div>
      </div>
      <p class="text-xs text-gray-500">Last fetched: {{ store.gdmfCatalog?.lastFetchedAt ? new Date(store.gdmfCatalog.lastFetchedAt).toLocaleString() : "Never" }}</p>
      <Button variant="ghost" :loading="store.isRefreshing" @click="store.refreshGdmfCatalog()">Refresh now</Button>
    </div>
  </div>
</template>
