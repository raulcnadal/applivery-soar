<script setup lang="ts">
// Policy Violators modal — reached by clicking a policy's Violators count in
// PoliciesTable.vue. Resolves the policy's live violating-device-id list
// (compliance.ts's fetchViolatingDeviceIds, the same endpoint the Violators
// column count itself is computed from) against the fleet already loaded by
// useDevicesStore — fetched here if the Compliance view hasn't triggered a
// Devices fetch yet, same cache-tolerant fetchDevices(false) every other
// entry point uses. Each row opens the shared Device modal (@open-device),
// same as DeviceFleetTable.vue's own row click.
import { Modal, EmptyState } from "@applivery/bluesky-vue";
import { computed, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore } from "../../stores/compliance";
import { useDevicesStore } from "../../stores/devices";

const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const RISK_TIER_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: SUCCESS },
  medium: { label: "Medium", color: WARNING },
  high: { label: "High", color: "#F97316" },
  critical: { label: "Critical", color: DANGER },
};
function riskMeta(tier: string) {
  return RISK_TIER_META[tier] || RISK_TIER_META.low;
}

const props = defineProps<{ open: boolean; policyId: string | null; policyName: string | null }>();
const emit = defineEmits<{ close: []; "open-device": [deviceId: string] }>();

const complianceStore = useComplianceStore();
const devicesStore = useDevicesStore();

const isLoading = ref(false);
const error = ref<string | null>(null);
const violatingIds = ref<string[]>([]);
const search = ref("");

watch(
  () => [props.open, props.policyId] as const,
  async ([open, policyId]) => {
    if (!open || !policyId) {
      violatingIds.value = [];
      error.value = null;
      search.value = "";
      return;
    }
    isLoading.value = true;
    error.value = null;
    try {
      if (devicesStore.devices.length === 0) await devicesStore.fetchDevices(false);
      violatingIds.value = await complianceStore.fetchViolatingDeviceIds(policyId);
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load violating devices.";
    } finally {
      isLoading.value = false;
    }
  },
  { immediate: true },
);

const matchedDevices = computed(() => {
  const idSet = new Set(violatingIds.value.map(String));
  return devicesStore.devices.filter((d) => idSet.has(String(d.id)));
});

const violatingDevices = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return matchedDevices.value;
  return matchedDevices.value.filter((d) => {
    const u = d.mdmUser as any;
    const userName = (u?.name || `${u?.firstName || ""} ${u?.lastName || ""}`).toLowerCase();
    return d.displayName.toLowerCase().includes(term) || userName.includes(term) || (u?.email || "").toLowerCase().includes(term) || (d.serialNumber || "").toLowerCase().includes(term);
  });
});

// A violating device ID with no match in devicesStore.devices — e.g. it was
// offboarded/unenrolled since the last violation, or the fleet fetch above
// raced the ID lookup — is dropped from the list rather than shown as a
// broken row; this count (unfiltered by search) says so instead of silently
// under-reporting.
const unresolvedCount = computed(() => violatingIds.value.length - matchedDevices.value.length);
</script>

<template>
  <Modal :open="open" :title="`Devices violating “${policyName || 'this policy'}”`" size="lg" @close="emit('close')">
    <div class="relative mb-3">
      <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
      <input
        v-model="search"
        placeholder="Search devices, users, serial…"
        class="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
      />
    </div>

    <div v-if="isLoading" class="flex flex-col items-center justify-center py-10 gap-2">
      <div class="w-6 h-6 border-2 rounded-full animate-spin" style="border-color: #0241e330; border-top-color: #0241e3" />
      <span class="text-xs text-gray-400">Loading violating devices…</span>
    </div>
    <div v-else-if="error" class="px-3 py-2.5 rounded-lg text-sm" :style="{ backgroundColor: `${DANGER}10`, color: DANGER }">{{ error }}</div>
    <EmptyState v-else-if="violatingDevices.length === 0" title="No violating devices" description="Either every scoped device is currently compliant, or none matches your search." />
    <div v-else class="space-y-1 max-h-[55vh] overflow-y-auto -mx-2">
      <button
        v-for="d in violatingDevices"
        :key="d.id"
        class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
        @click="emit('open-device', d.id)"
      >
        <component :is="ICONS.Smartphone" :size="14" weight="Linear" class="shrink-0 text-gray-400" />
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate text-gray-900 dark:text-white">{{ d.displayName }}</p>
          <p class="text-[11px] truncate text-gray-400">
            {{ d.platformLabel }}<template v-if="(d.mdmUser as any)?.email"> · {{ (d.mdmUser as any).email }}</template>
          </p>
        </div>
        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0" :style="{ backgroundColor: `${riskMeta(d.riskTier).color}15`, color: riskMeta(d.riskTier).color }">
          {{ riskMeta(d.riskTier).label }} · {{ d.riskScore }}
        </span>
        <component :is="ICONS.AltArrowRight" :size="13" weight="Linear" class="shrink-0 text-gray-400" />
      </button>
      <p v-if="unresolvedCount > 0 && !search.trim()" class="px-3 pt-1 text-[11px] text-gray-400">
        {{ unresolvedCount }} violating device{{ unresolvedCount === 1 ? "" : "s" }} couldn't be matched to the current fleet (likely offboarded since the last check).
      </p>
    </div>
  </Modal>
</template>
