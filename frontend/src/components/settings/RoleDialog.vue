<script setup lang="ts">
// Create/edit a SOAR Role. Port of docs/settings.md#roles' "Create/Edit
// fields" list (main.py:1094 RolePayload) — 8 feature areas x 3-way
// (none/read/manage) toggle, 5 independent high-risk-action checkboxes,
// free-typed Applivery tag values, and an optional segment scope.
//
// Deliberately NOT a <Modal> — the original's RolesSettings.jsx renders
// Create/Edit Role as a plain inline state swap inside the Settings
// content pane (`if (editing) return <RoleEditor .../>`, RolesSettings.jsx
// ~line 337), replacing the Roles list in place, same left-nav/footer
// chrome staying visible throughout. This component used to wrap itself in
// the shared Modal (Teleport-to-body, fixed overlay) instead, which put it
// visually behind SettingsModal.vue's own overlay/blur (a plain z-index
// comparison between fixed-position siblings under <body> — no number was
// ever going to make a floating dialog match "renders inside the settings
// panel," since the original never puts this behind an overlay at all).
// RolesSettingsPanel.vue now v-if's between the list view and this
// component directly, mirroring the original's editing-state swap.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, watch } from "vue";
import { ref } from "vue";
import { useRolesStore, type RolePayload, type SoarRole } from "../../stores/roles";
import { useDevicesStore } from "../../stores/devices";
import type { FeatureArea, FeatureLevel, RiskyAction } from "../../stores/auth";

const props = defineProps<{ role: SoarRole | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useRolesStore();
const devicesStore = useDevicesStore();

const FEATURE_AREA_LABELS: Record<FeatureArea, string> = {
  devices: "Devices",
  compliance: "Compliance Policies",
  workflows: "Workflows",
  cases: "Cases",
  integrations: "Integrations & Threat Intel",
  reporting: "Reporting & Widgets",
  settings: "Settings",
  auditLog: "Audit Log",
};
const FEATURE_AREAS: FeatureArea[] = ["devices", "compliance", "workflows", "cases", "integrations", "reporting", "settings", "auditLog"];
const LEVEL_OPTIONS: Array<{ value: FeatureLevel; label: string }> = [
  { value: "none", label: "No access" },
  { value: "read", label: "View only" },
  { value: "manage", label: "Manage" },
];

const RISKY_ACTIONS: Array<{ key: RiskyAction; label: string; description: string }> = [
  { key: "canDeletePolicyOrWorkflow", label: "Delete Compliance Policies or Workflows", description: "" },
  { key: "canRunDestructiveWorkflow", label: "Run a workflow containing a destructive MDM step", description: "wipe, unenroll, etc." },
  { key: "canEditIntegrationSecrets", label: "Create/edit/delete/test Integrations & Threat Intel providers", description: "also gates Vulnerability Service edits" },
  { key: "canExportOrImportConfig", label: "Export, import, or clone workspace configuration", description: "" },
  { key: "canBulkTriage", label: "Bulk-approve/dismiss violations, or bulk-update Cases", description: "" },
];

function emptyFeatureAccess(): Record<FeatureArea, FeatureLevel> {
  return Object.fromEntries(FEATURE_AREAS.map((a) => [a, "none"])) as Record<FeatureArea, FeatureLevel>;
}
function emptyRiskyActions(): Record<RiskyAction, boolean> {
  return Object.fromEntries(RISKY_ACTIONS.map((a) => [a.key, false])) as Record<RiskyAction, boolean>;
}

const form = reactive({
  name: "",
  description: "",
  featureAccess: emptyFeatureAccess(),
  riskyActions: emptyRiskyActions(),
  appliveryTagValues: "",
  segmentIds: [] as string[],
});
const isSaving = ref(false);
const saveError = ref<string | null>(null);

onMounted(async () => {
  if (devicesStore.segments.length === 0) await devicesStore.fetchPickers();
});

// Runs once at mount (this component only exists in the DOM while active —
// RolesSettingsPanel.vue v-if's it in/out — so there's no separate "open"
// transition to react to the way a Modal-based dialog would need).
watch(
  () => props.role,
  (r) => {
    form.name = r?.name ?? "";
    form.description = r?.description ?? "";
    form.featureAccess = { ...emptyFeatureAccess(), ...(r?.featureAccess ?? {}) } as Record<FeatureArea, FeatureLevel>;
    form.riskyActions = { ...emptyRiskyActions(), ...(r?.riskyActions ?? {}) } as Record<RiskyAction, boolean>;
    form.appliveryTagValues = (r?.appliveryTagValues ?? []).join(", ");
    form.segmentIds = [...(r?.segmentIds ?? [])];
    saveError.value = null;
  },
  { immediate: true },
);

function toggleSegment(id: string) {
  const idx = form.segmentIds.indexOf(id);
  if (idx === -1) form.segmentIds.push(id);
  else form.segmentIds.splice(idx, 1);
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload: RolePayload = {
      name: form.name,
      description: form.description,
      featureAccess: form.featureAccess,
      riskyActions: form.riskyActions,
      appliveryTagValues: form.appliveryTagValues.split(",").map((t) => t.trim()).filter(Boolean),
      segmentIds: form.segmentIds,
    };
    if (props.role) await store.updateRole(props.role.id, payload);
    else await store.createRole(payload);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save role.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div>
    <h3 class="text-sm font-bold mb-4 text-gray-900 dark:text-white">{{ role ? `Edit "${role.name}"` : "New SOAR Role" }}</h3>
    <div class="p-5 rounded-xl border shadow-sm max-w-3xl border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-4">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Role name" />
      <Input v-model="form.description" label="Description" />

      <div>
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Feature access</p>
        <div class="space-y-2">
          <div v-for="area in FEATURE_AREAS" :key="area" class="grid grid-cols-2 gap-3 items-center">
            <span class="text-sm text-gray-700 dark:text-gray-200">{{ FEATURE_AREA_LABELS[area] }}</span>
            <Input
              :model-value="form.featureAccess[area]"
              type="select"
              :options="LEVEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))"
              @update:model-value="form.featureAccess[area] = $event as FeatureLevel"
            />
          </div>
        </div>
      </div>

      <div>
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">High-risk actions</p>
        <div class="space-y-2">
          <label v-for="a in RISKY_ACTIONS" :key="a.key" class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" class="mt-0.5" v-model="form.riskyActions[a.key]" />
            <span>{{ a.label }}<span v-if="a.description" class="text-gray-400"> ({{ a.description }})</span></span>
          </label>
        </div>
      </div>

      <Input
        v-model="form.appliveryTagValues"
        label="Applivery collaborator tag/group values (comma-separated)"
        placeholder="soc-analyst, tier2"
      />
      <p class="text-xs text-gray-400 -mt-3">Collaborators whose Applivery tags match one of these values earn this role. A role with none mapped is currently unreachable.</p>

      <div v-if="devicesStore.segments.length > 0">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Segments (optional)</p>
        <p class="text-xs text-gray-400 mb-2">Scopes which segment-tagged Compliance Policies this role's holders can manage. Leave empty for no restriction.</p>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="seg in devicesStore.segments"
            :key="seg.id"
            class="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-full px-2.5 py-1 cursor-pointer"
            :class="form.segmentIds.includes(seg.id) ? 'bg-brand-50 border-brand-300 text-brand-700' : 'text-gray-600 dark:text-gray-300'"
          >
            <input type="checkbox" class="hidden" :checked="form.segmentIds.includes(seg.id)" @change="toggleSegment(seg.id)" />
            {{ seg.name }}
          </label>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!form.name" @click="save">{{ role ? "Save changes" : "Create role" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </div>
</template>
