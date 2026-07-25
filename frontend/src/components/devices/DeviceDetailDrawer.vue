<script setup lang="ts">
// Device detail drawer — identifiers, risk breakdown, active policies,
// open cases/violations (both empty until Phase 5/Phase 3 respectively —
// see devices.service.ts's TODOs), plus the segment/tags/policy editors.
import { Drawer, StatusPill } from "@applivery/bluesky-vue";
import { computed } from "vue";
import { useDevicesStore, type NormalizedDevice, type RiskTier } from "../../stores/devices";
import DevicePickers from "./DevicePickers.vue";

const props = defineProps<{
  device: NormalizedDevice | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const store = useDevicesStore();

const RISK_COLOR: Record<RiskTier, "green" | "yellow" | "orange" | "red"> = {
  low: "green",
  medium: "yellow",
  high: "orange",
  critical: "red",
};

const open = computed(() => props.device !== null);

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
</script>

<template>
  <Drawer :open="open" :title="device?.displayName ?? ''" width="w-[480px]" @close="emit('close')">
    <div v-if="device" class="space-y-6">
      <div class="flex items-center gap-2">
        <StatusPill :label="device.platformLabel" color="brand" />
        <StatusPill :label="device.isCompliant ? 'Compliant' : 'Non-compliant'" :color="device.isCompliant ? 'green' : 'red'" />
        <StatusPill :label="`Risk: ${device.riskTier} (${device.riskScore})`" :color="RISK_COLOR[device.riskTier]" />
      </div>

      <section>
        <p class="text-sm font-semibold text-gray-900 mb-2">Identifiers</p>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-gray-400">Serial</dt>
          <dd class="text-gray-700">{{ device.serialNumber || "—" }}</dd>
          <dt class="text-gray-400">Model</dt>
          <dd class="text-gray-700">{{ device.model || "—" }}</dd>
          <dt class="text-gray-400">Manufacturer</dt>
          <dd class="text-gray-700">{{ device.manufacturer || "—" }}</dd>
          <dt class="text-gray-400">OS Version</dt>
          <dd class="text-gray-700">{{ device.osVersion || "—" }}</dd>
          <dt class="text-gray-400">UDID</dt>
          <dd class="text-gray-700 truncate">{{ device.identifiers.udid || "—" }}</dd>
          <dt class="text-gray-400">Enrolled</dt>
          <dd class="text-gray-700">{{ formatDate(device.enrolledAt) }}</dd>
          <dt class="text-gray-400">Last seen</dt>
          <dd class="text-gray-700">{{ formatDate(device.lastSeen) }}</dd>
        </dl>
      </section>

      <section v-if="device.riskFactors.length > 0">
        <p class="text-sm font-semibold text-gray-900 mb-2">Risk factors</p>
        <ul class="space-y-1.5">
          <li v-for="(factor, i) in device.riskFactors" :key="i" class="flex items-center justify-between text-sm">
            <span class="text-gray-600">{{ factor.label }}</span>
            <span class="text-gray-400">+{{ factor.points }}</span>
          </li>
        </ul>
      </section>

      <section v-if="device.activePolicies.length > 0">
        <p class="text-sm font-semibold text-gray-900 mb-2">Active policies</p>
        <ul class="space-y-1 text-sm text-gray-700">
          <li v-for="p in device.activePolicies" :key="`${p.platform}:${p.id}`">{{ p.name }}</li>
        </ul>
      </section>

      <section v-if="device.smartAttributes.length > 0">
        <p class="text-sm font-semibold text-gray-900 mb-2">Smart attributes</p>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <template v-for="attr in device.smartAttributes" :key="attr.name">
            <dt class="text-gray-400">{{ attr.name }}</dt>
            <dd class="text-gray-700">{{ attr.value }}</dd>
          </template>
        </dl>
      </section>

      <!-- TODO(Phase5): open Cases will render here once Cases exist. -->
      <!-- TODO(Phase3): active Compliance Policy violations will render here. -->

      <section class="border-t border-gray-100 pt-4">
        <p class="text-sm font-semibold text-gray-900 mb-3">Edit device</p>
        <DevicePickers
          :device-id="device.id"
          :platform="device.platform"
          :segment-id="device.segmentId"
          :tags="device.tags"
          :active-policies="device.activePolicies"
          @saved="store.fetchDevices(true)"
        />
      </section>
    </div>
  </Drawer>
</template>
