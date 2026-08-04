<script setup lang="ts">
// Case Auto-Run Rules Settings tab. Port of CaseAutoRunRulesSettings.jsx
// (wow-dashboard/src/components/settings/CaseAutoRunRulesSettings.jsx).
//
// Deliberately NOT a Modal -- the original renders create/edit inline,
// directly above the rule list, toggled by local `editing` state
// (undefined = closed, null = new, object = editing that rule), and the
// list itself is a card list, not a table. Same swap pattern already
// established for Roles (RolesSettingsPanel.vue / RoleDialog.vue). This
// replaces the former CaseAutoRunRulesTable.vue + CaseAutoRunRuleDialog.vue
// pair, whose Modal-based dialog rendered behind SettingsModal.vue's own
// overlay -- the fix is architectural (never use a Modal here at all), not
// a z-index tweak.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useCasesStore, type CaseAutoRunRule } from "../../stores/cases";
import { useWorkflowsStore } from "../../stores/workflows";
import { useComplianceStore } from "../../stores/compliance";
import { tacticColorMap } from "../../lib/mitreCatalog";
import MitreTagPicker from "../shared/MitreTagPicker.vue";

const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const store = useCasesStore();
const workflowsStore = useWorkflowsStore();
const complianceStore = useComplianceStore();

// undefined = form closed, null = "new rule" form open, object = editing
// that rule -- mirrors the original's tri-state `editing` local state.
const editing = ref<CaseAutoRunRule | null | undefined>(undefined);

function blankForm() {
  return { name: "", enabled: true, minSeverity: "high", mitreTechniques: [] as string[], workflowId: "", autoRunDestructiveAck: false, maxFiresPerHour: 10 };
}
const form = reactive(blankForm());
const isSaving = ref(false);
const saveError = ref<string | null>(null);

function openNew() {
  editing.value = null;
  Object.assign(form, blankForm());
  saveError.value = null;
}
function openEdit(r: CaseAutoRunRule) {
  editing.value = r;
  Object.assign(form, {
    name: r.name, enabled: r.enabled, minSeverity: r.minSeverity,
    mitreTechniques: [...(r.mitreTechniques ?? [])], workflowId: r.workflowId,
    autoRunDestructiveAck: r.autoRunDestructiveAck ?? false, maxFiresPerHour: r.maxFiresPerHour ?? 10,
  });
  saveError.value = null;
}
function closeEditor() {
  editing.value = undefined;
}

async function remove(r: CaseAutoRunRule) {
  if (!confirm(`Delete rule "${r.name}"?`)) return;
  await store.deleteAutoRunRule(r.id);
}

const selectedWorkflow = computed(() => workflowsStore.workflows.find((w) => w.id === form.workflowId));
// Broader, UI-only "does this workflow contain any MDM action step" check --
// same conservative heuristic WorkflowsTable.vue's hasDestructive() uses.
const isDestructiveWorkflow = computed(() => (selectedWorkflow.value?.steps ?? []).some((s: any) => s.type === "mdm_action"));
const tacticColor = computed(() => tacticColorMap(complianceStore.mitreTactics));

async function save() {
  if (isDestructiveWorkflow.value && !form.autoRunDestructiveAck) {
    saveError.value = `"${selectedWorkflow.value?.name}" includes a destructive action — check the acknowledgment below to save.`;
    return;
  }
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = {
      name: form.name, enabled: form.enabled, minSeverity: form.minSeverity,
      mitreTechniques: form.mitreTechniques, workflowId: form.workflowId,
      autoRunDestructiveAck: form.autoRunDestructiveAck, maxFiresPerHour: form.maxFiresPerHour,
    };
    if (editing.value) await store.updateAutoRunRule(editing.value.id, payload);
    else await store.createAutoRunRule(payload);
    closeEditor();
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save rule.";
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  if (workflowsStore.workflows.length === 0) await workflowsStore.fetchWorkflows();
  if (complianceStore.mitreTechniques.length === 0) await complianceStore.fetchMitreTechniques();
});
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-sm font-bold text-gray-900 dark:text-white">Case Auto-Run Rules</h3>
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      Fires a Workflow automatically against a Case's device the moment it's opened, if the Case's severity and MITRE
      techniques match. Runs unattended — the same destructive-action acknowledgment Compliance Policy autoRun uses applies here too.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <form v-if="editing !== undefined" class="p-4 rounded-xl mb-3 space-y-3 border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800" @submit.prevent="save">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" />
      <Input
        :model-value="form.workflowId" type="select"
        :options="workflowsStore.workflows.map((w) => ({ value: w.id, label: w.name }))"
        label="Workflow to run" @update:model-value="form.workflowId = $event as string"
      />
      <Input
        :model-value="form.minSeverity" type="select"
        :options="['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s }))"
        label="Minimum severity to match" @update:model-value="form.minSeverity = $event as string"
      />
      <Input v-model.number="form.maxFiresPerHour" type="number" label="Max fires per hour" />

      <div>
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">MITRE ATT&amp;CK filter (optional)</p>
        <MitreTagPicker
          :techniques="complianceStore.mitreTechniques"
          :tactics="complianceStore.mitreTactics"
          :tactic-color="tacticColor"
          :selected="form.mitreTechniques"
          :catalog-meta="complianceStore.mitreCatalogMeta"
          :can-refresh-catalog="true"
          @change="(ids: string[]) => (form.mitreTechniques = ids)"
          @refresh="complianceStore.refreshMitreCatalogNow()"
        />
      </div>

      <div v-if="isDestructiveWorkflow" class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border" :style="{ backgroundColor: `${DANGER}10`, borderColor: `${DANGER}30` }">
        <component :is="ICONS.DangerTriangle" :size="15" weight="Linear" class="shrink-0 mt-0.5" :style="{ color: DANGER }" />
        <div class="flex-1">
          <p class="text-xs font-semibold" :style="{ color: DANGER }">"{{ selectedWorkflow?.name }}" includes a destructive action</p>
          <p class="text-[11px] mt-0.5 mb-2 leading-relaxed text-gray-400">This rule fires unattended the moment a matching Case opens, with no human review.</p>
          <label class="flex items-center gap-2 text-xs font-medium cursor-pointer text-gray-900 dark:text-white">
            <input v-model="form.autoRunDestructiveAck" type="checkbox" /> I acknowledge this workflow may contain a destructive action
          </label>
        </div>
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" v-model="form.enabled" /> Enabled</label>

      <div class="flex items-center gap-2 pt-2">
        <Button type="submit" :loading="isSaving" :disabled="!form.name || !form.workflowId">{{ editing ? "Save changes" : "Create rule" }}</Button>
        <Button variant="ghost" type="button" @click="closeEditor">Cancel</Button>
      </div>
    </form>

    <div v-if="store.autoRunRules.length === 0" class="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      No Case Auto-Run rules yet.
    </div>
    <div v-else class="space-y-2">
      <div v-for="r in store.autoRunRules" :key="r.id" class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <component :is="ICONS.Target" :size="16" weight="Linear" class="shrink-0 text-gray-400" />
          <div class="min-w-0">
            <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ r.name }}</p>
            <p class="text-[11px] text-gray-400">{{ (r.recentFires ?? []).length }} fired in the last hour</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: r.enabled ? '#22C55E20' : '#9CA3AF20', color: r.enabled ? '#22C55E' : '#9CA3AF' }">
            {{ r.enabled ? "Enabled" : "Disabled" }}
          </span>
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: `${WARNING}20`, color: WARNING }">{{ r.minSeverity }}</span>
          <button type="button" class="text-gray-400 hover:text-brand-600" title="Edit" @click="openEdit(r)"><component :is="ICONS.Pen" :size="15" weight="Linear" /></button>
          <button type="button" class="text-gray-400 hover:text-red-500" title="Delete" @click="remove(r)"><component :is="ICONS.TrashBinTrash" :size="15" weight="Linear" /></button>
        </div>
      </div>
    </div>

    <p v-if="editing === undefined && workflowsStore.workflows.length === 0" class="text-xs text-gray-400">Create a Workflow first.</p>
    <div v-if="editing === undefined" class="flex justify-start">
      <Button :disabled="workflowsStore.workflows.length === 0" @click="openNew">
        <component :is="ICONS.AddCircle" :size="15" weight="Linear" /> New Rule
      </Button>
    </div>
  </div>
</template>
