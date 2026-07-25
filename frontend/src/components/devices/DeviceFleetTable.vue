<script setup lang="ts">
// Fleet table for the Devices view — one row per normalized device from
// GET /api/devices. Mirrors the original App.jsx Devices table's columns
// (platform, model/OS, battery, compliance, risk tier, state, tags) plus a
// bulk-select checkbox column feeding the "Re-attest selected" action bar.
import { Checkbox, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { computed } from "vue";
import type { NormalizedDevice, RiskTier } from "../../stores/devices";

const props = defineProps<{
  devices: NormalizedDevice[];
  selectedIds: Set<string>;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  "toggle-select": [deviceId: string];
  "toggle-select-all": [];
  "open-device": [deviceId: string];
}>();

const allSelected = computed(() => props.devices.length > 0 && props.devices.every((d) => props.selectedIds.has(d.id)));
const someSelected = computed(() => props.devices.some((d) => props.selectedIds.has(d.id)) && !allSelected.value);

const RISK_COLOR: Record<RiskTier, "green" | "yellow" | "orange" | "red"> = {
  low: "green",
  medium: "yellow",
  high: "orange",
  critical: "red",
};

const STATE_COLOR: Record<string, "green" | "gray" | "red" | "yellow"> = {
  active: "green",
  enrolled: "green",
  online: "green",
  offline: "gray",
  unenrolled: "red",
  wiped: "red",
  pending: "yellow",
};

function stateColor(state: string): "green" | "gray" | "red" | "yellow" {
  return STATE_COLOR[state] ?? "gray";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="w-10 px-4 py-3">
            <Checkbox :model-value="allSelected" :indeterminate="someSelected" @update:model-value="emit('toggle-select-all')" />
          </th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Device</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Platform</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">OS Version</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Battery</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Compliant</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Risk</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">State</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Tags</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Last Seen</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr
          v-for="device in devices"
          :key="device.id"
          class="hover:bg-gray-50 cursor-pointer transition-colors"
          @click="emit('open-device', device.id)"
        >
          <td class="px-4 py-3" @click.stop>
            <Checkbox :model-value="selectedIds.has(device.id)" @update:model-value="emit('toggle-select', device.id)" />
          </td>
          <td class="px-4 py-3">
            <p class="font-medium text-gray-900">{{ device.displayName }}</p>
            <p class="text-xs text-gray-400">{{ device.serialNumber || device.model || "—" }}</p>
          </td>
          <td class="px-4 py-3 text-gray-600">{{ device.platformLabel }}</td>
          <td class="px-4 py-3 text-gray-600">{{ device.osVersion || "—" }}</td>
          <td class="px-4 py-3 text-gray-600">{{ device.battery !== null ? `${device.battery}%` : "—" }}</td>
          <td class="px-4 py-3">
            <StatusPill :label="device.isCompliant ? 'Compliant' : 'Non-compliant'" :color="device.isCompliant ? 'green' : 'red'" />
          </td>
          <td class="px-4 py-3">
            <StatusPill :label="device.riskTier" :color="RISK_COLOR[device.riskTier]" />
            <span class="ml-1 text-xs text-gray-400">{{ device.riskScore }}</span>
          </td>
          <td class="px-4 py-3">
            <StatusPill :label="device.state" :color="stateColor(device.state)" />
          </td>
          <td class="px-4 py-3">
            <div class="flex flex-wrap gap-1 max-w-[180px]">
              <span
                v-for="tag in device.tags.slice(0, 3)"
                :key="tag"
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600"
              >
                {{ tag }}
              </span>
              <span v-if="device.tags.length > 3" class="text-xs text-gray-400">+{{ device.tags.length - 3 }}</span>
              <span v-if="device.tags.length === 0" class="text-xs text-gray-300">—</span>
            </div>
          </td>
          <td class="px-4 py-3 text-gray-500 text-xs">{{ formatDate(device.lastSeen) }}</td>
        </tr>
      </tbody>
    </table>

    <EmptyState
      v-if="!isLoading && devices.length === 0"
      title="No devices match the current filters"
      description="Try clearing the search, platform, or compliance filters."
    />
  </div>
</template>
