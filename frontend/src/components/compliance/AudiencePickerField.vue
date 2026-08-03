<script setup lang="ts">
// Port of AudiencePickerField (DevicePickers.jsx:534-573) — a Device
// Audience <select> plus a "New" button that opens DeviceAudienceCreateModal
// inline. Used by the device_audience condition type and the Policy
// Builder's "Apply to devices" section.
import { ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import DeviceAudienceCreateModal from "./DeviceAudienceCreateModal.vue";

const props = defineProps<{ value: string; audiences: Array<{ id: string; name: string }> }>();
const emit = defineEmits<{ select: [id: string]; created: [audience: { id: string; name: string }] }>();

const isCreating = ref(false);

function onCreated(audience: { id: string; name: string }) {
  isCreating.value = false;
  emit("created", audience);
  emit("select", audience.id);
}
</script>

<template>
  <div class="flex items-center gap-2">
    <select
      :value="props.value || ''"
      class="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 bg-white focus:ring-2 focus:ring-brand-500"
      @change="emit('select', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">{{ audiences.length ? "Select a Device Audience…" : "No Device Audiences found" }}</option>
      <option v-for="a in audiences" :key="a.id" :value="a.id">{{ a.name }}</option>
    </select>
    <button type="button" class="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium shrink-0 border border-gray-200 text-gray-700" @click="isCreating = true">
      <component :is="ICONS.AddSquare" :size="12" weight="Linear" /> New
    </button>
  </div>
  <DeviceAudienceCreateModal :open="isCreating" @close="isCreating = false" @created="onCreated" />
</template>
