<script setup lang="ts">
// Firewall Policy Library — port of FirewallLibraryView.jsx's list + header
// (compact rows with posture/rule-count badges). The original edits a rule
// set inline in the list (RuleSetForm swapped in place) and shows a
// TemplatePicker before a blank form; this still opens
// FirewallRuleSetBuilderDrawer as a drawer (a disclosed, timeboxed
// deviation — the field content and template-start flow both match) rather
// than the fully inline card-editing the original uses.
import { computed } from "vue";
import { EmptyState } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useFirewallRuleSetsStore, type FirewallRuleSet } from "../../stores/firewallRuleSets";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const props = defineProps<{ ruleSets: FirewallRuleSet[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [FirewallRuleSet]; new: [] }>();

const store = useFirewallRuleSetsStore();

const withPosture = computed(() =>
  props.ruleSets.map((r) => ({ ...r, hasDefaultPosture: r.defaultInboundAction !== "notConfigured" || r.defaultOutboundAction !== "notConfigured" })),
);

async function remove(rs: FirewallRuleSet) {
  if (!confirm(`Remove "${rs.name}" from the library? Devices it's already been applied to keep those rules until explicitly restored — deleting this only removes the ability to apply/restore it via new workflow runs.`)) return;
  await store.deleteRuleSet(rs.id);
}
</script>

<template>
  <div>
    <div class="mb-4">
      <h2 class="text-lg font-bold text-gray-900 dark:text-white">Firewall Policy Library</h2>
      <p class="text-sm mt-1 max-w-2xl text-gray-400">
        Windows-only. Build a set of firewall rules once, then reference it from a workflow's "Apply Firewall Rule Set" and "Restore Firewall" steps. Every rule is tagged so it can be cleanly removed later — a device's normal firewall behavior returns automatically once the tagged rules are gone.
      </p>
    </div>

    <div class="space-y-2.5 max-w-2xl">
      <EmptyState v-if="!isLoading && ruleSets.length === 0" title="Nothing in the library yet" description="Compose a named set of Windows Firewall rules — Isolate Device, Block Lateral Movement, etc. — to apply/restore from a workflow action." />
      <div v-for="rs in withPosture" :key="rs.id" class="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800">
        <component :is="ICONS.ShieldCheck" :size="14" weight="Linear" class="shrink-0 mt-0.5 text-gray-400" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold truncate text-gray-900 dark:text-white">{{ rs.name }}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 bg-gray-100 dark:bg-gray-700 text-gray-400">
              {{ rs.rules?.length || 0 }} rule{{ (rs.rules?.length || 0) === 1 ? "" : "s" }}
            </span>
            <span v-if="rs.ensureFirewallEnabled" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">Enables Firewall</span>
            <span v-else class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }">Assumes EDR-managed</span>
            <span v-if="rs.hasDefaultPosture" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${DANGER}12`, color: DANGER }">Changes default posture</span>
          </div>
          <p v-if="rs.description" class="text-[10px] mt-0.5 text-gray-400">{{ rs.description }}</p>
        </div>
        <button title="Edit" class="p-1.5 rounded-lg shrink-0 text-gray-400" @click="emit('edit', rs)">
          <component :is="ICONS.Pen2" :size="13" weight="Linear" />
        </button>
        <button title="Remove" class="p-1.5 rounded-lg shrink-0" :style="{ color: DANGER }" @click="remove(rs)">
          <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
        </button>
      </div>

      <button class="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-400 hover:text-brand-600 hover:border-brand-500 transition-colors" @click="emit('new')">
        <component :is="ICONS.AddSquare" :size="13" weight="Linear" /> Add to library
      </button>
    </div>

    <p class="inline-flex items-start gap-1.5 text-[10px] mt-4 max-w-2xl" :style="{ color: WARNING }">
      <component :is="ICONS.InfoCircle" :size="11" weight="Linear" class="shrink-0 mt-0.5" />
      Windows only. Restore only removes the rules tagged with this rule set — it isn't a full firewall snapshot, so the device's prior firewall state returns automatically once the tagged rules are gone, assuming nothing else changed the firewall in between.
    </p>
  </div>
</template>
