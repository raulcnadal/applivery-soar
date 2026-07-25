<script setup lang="ts">
// Segment / tags / policy-stack editors for a single device — ported from
// the Flutter reference's device profile sheet (main.py:3621 module
// comment) via the three PUT endpoints devices.controller.ts exposes:
// /segment, /tags, /policies. Kept as one component (not three) since all
// three editors share the same device + platform context and are always
// shown together in the detail drawer.
import { Button, Input, RichSelect } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useDevicesStore, type ActivePolicy, type PickerItem } from "../../stores/devices";

const props = defineProps<{
  deviceId: string;
  platform: string;
  segmentId: string | number | null;
  tags: string[];
  activePolicies: ActivePolicy[];
}>();

const emit = defineEmits<{
  saved: [];
}>();

const store = useDevicesStore();

const segmentDraft = ref(props.segmentId !== null ? String(props.segmentId) : "");
const tagsDraft = ref(props.tags.join(", "));
const policyOptions = ref<PickerItem[]>([]);
const policyDraft = ref<string[]>(props.activePolicies.map((p) => p.id ?? "").filter(Boolean));
const savingSegment = ref(false);
const savingTags = ref(false);
const savingPolicies = ref(false);

const segmentOptions = computed(() => store.segments.map((s) => ({ value: s.id, label: s.name })));

async function loadPolicies() {
  try {
    policyOptions.value = await store.getPolicies(props.platform);
  } catch {
    policyOptions.value = [];
  }
}

onMounted(loadPolicies);
watch(() => props.platform, loadPolicies);

async function saveSegment() {
  if (!segmentDraft.value) return;
  savingSegment.value = true;
  try {
    await store.updateSegment(props.deviceId, props.platform, Number(segmentDraft.value));
    emit("saved");
  } finally {
    savingSegment.value = false;
  }
}

async function saveTags() {
  savingTags.value = true;
  try {
    const tags = tagsDraft.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await store.updateTags(props.deviceId, props.platform, tags);
    emit("saved");
  } finally {
    savingTags.value = false;
  }
}

async function savePolicies() {
  savingPolicies.value = true;
  try {
    const policies = policyDraft.value.map((id) => ({ id }));
    await store.updatePolicies(props.deviceId, props.platform, policies);
    emit("saved");
  } finally {
    savingPolicies.value = false;
  }
}

function togglePolicy(id: string) {
  const idx = policyDraft.value.indexOf(id);
  if (idx >= 0) policyDraft.value.splice(idx, 1);
  else policyDraft.value.push(id);
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <p class="text-sm font-medium text-gray-700 mb-2">Segment</p>
      <div class="flex items-center gap-2">
        <RichSelect :options="segmentOptions" :model-value="segmentDraft" placeholder="Choose segment…" @update:model-value="segmentDraft = $event" />
        <Button size="sm" :loading="savingSegment" @click="saveSegment">Move</Button>
      </div>
    </div>

    <div>
      <p class="text-sm font-medium text-gray-700 mb-2">Tags</p>
      <Input v-model="tagsDraft" placeholder="comma, separated, tags" />
      <div class="mt-2">
        <Button size="sm" :loading="savingTags" @click="saveTags">Save tags</Button>
      </div>
    </div>

    <div>
      <p class="text-sm font-medium text-gray-700 mb-2">Policy stack (first is primary)</p>
      <div class="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
        <label v-for="opt in policyOptions" :key="opt.id" class="flex items-center gap-2 text-sm px-1 py-1 cursor-pointer">
          <input type="checkbox" :checked="policyDraft.includes(opt.id)" @change="togglePolicy(opt.id)" />
          {{ opt.name }}
        </label>
        <p v-if="policyOptions.length === 0" class="text-xs text-gray-400 px-1 py-1">No policies found for this platform.</p>
      </div>
      <div class="mt-2">
        <Button size="sm" :loading="savingPolicies" @click="savePolicies">Save policy stack</Button>
      </div>
    </div>
  </div>
</template>
