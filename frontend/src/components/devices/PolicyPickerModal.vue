<script setup lang="ts">
// Port of PolicyPickerModal (DevicePickers.jsx:87-158) — assigns a policy
// to a single device's stack (excludes already-assigned policies).
import { Modal } from "@applivery/bluesky-vue";
import { computed, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore, type PickerItem } from "../../stores/devices";

const props = defineProps<{ open: boolean; platform: string; excludeIds: Array<string | null> }>();
const emit = defineEmits<{ close: []; select: [policy: PickerItem] }>();

const store = useDevicesStore();
const policies = ref<PickerItem[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);
const search = ref("");

async function load() {
  isLoading.value = true;
  error.value = null;
  try {
    policies.value = await store.getPolicies(props.platform);
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to load policies.";
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => [props.open, props.platform],
  ([open]) => {
    if (open) load();
  },
  { immediate: true },
);

const excluded = computed(() => new Set((props.excludeIds || []).filter(Boolean).map(String)));
const available = computed(() => policies.value.filter((p) => !excluded.value.has(String(p.id)) && p.name.toLowerCase().includes(search.value.toLowerCase())));
</script>

<template>
  <Modal :open="open" title="Assign policy" size="md" @close="emit('close')">
    <div class="relative mb-3">
      <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
      <input
        v-model="search"
        autofocus
        placeholder="Search policies…"
        class="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
      />
    </div>
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <div class="w-5 h-5 border-2 rounded-full animate-spin" style="border-color: #0241e330; border-top-color: #0241e3" />
    </div>
    <p v-else-if="error" class="text-xs text-center py-6" style="color: #ef4444">{{ error }}</p>
    <div v-else class="space-y-1 max-h-[50vh] overflow-y-auto">
      <button
        v-for="p in available"
        :key="p.id"
        class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors hover:bg-gray-50"
        @click="emit('select', p)"
      >
        <component :is="ICONS.ShieldCheck" :size="13" weight="Linear" class="text-gray-400" />
        <span class="text-gray-900">{{ p.name }}</span>
      </button>
      <p v-if="available.length === 0" class="text-xs text-center py-6 text-gray-400">
        {{ policies.length === 0 ? "No policies found for this platform." : "No more policies available to assign." }}
      </p>
    </div>
  </Modal>
</template>
