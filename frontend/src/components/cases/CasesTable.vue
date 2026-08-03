<script setup lang="ts">
// Case list rows — presentational only, filtering lives in CasesView.vue
// (matches the original's single-component structure, split here to match
// the rest of this app's view/table component pattern). Port of the list
// portion of CasesView.jsx (lines ~458-540): checkbox select-all, source
// icon, MITRE pills, SlaBadge, severity/status badges, and a bulk bar
// gated by canBulkTriage.
import { computed, ref } from "vue";
import { EmptyState } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import type { MitreTechniqueDef } from "../../lib/mitreCatalog";
import MitreTagPills from "../shared/MitreTagPills.vue";
import SlaBadge from "./SlaBadge.vue";
import type { Case } from "../../stores/cases";

const PRIMARY_BLUE = "#0241E3";
const MUTED = "#94A3B8";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const props = defineProps<{
  cases: Case[];
  isLoading: boolean;
  totalCases: number;
  canBulkTriage: boolean;
  currentUserEmail: string | null;
  techniqueById: Record<string, MitreTechniqueDef>;
  tacticColor: Record<string, string>;
}>();

const emit = defineEmits<{ open: [Case]; bulkAssign: [string[]]; bulkClose: [string[]] }>();

const SEVERITY_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: MUTED },
  medium: { label: "Medium", color: WARNING },
  high: { label: "High", color: "#F97316" },
  critical: { label: "Critical", color: DANGER },
};
const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: WARNING },
  investigating: { label: "Investigating", color: PRIMARY_BLUE },
  resolved: { label: "Resolved", color: "#22C55E" },
  closed: { label: "Closed", color: MUTED },
  false_positive: { label: "False positive", color: MUTED },
};
const SOURCE_META: Record<string, { label: string; icon: keyof typeof ICONS }> = {
  compliance_violation: { label: "Compliance", icon: "ShieldWarning" },
  workflow_trigger: { label: "Inbound trigger", icon: "PlugCircle" },
  manual: { label: "Manual", icon: "Pen" },
};

const notPermittedTitle = "Your role isn't permitted to bulk-update Cases.";

const selectedIds = ref<Set<string>>(new Set());
const allSelected = computed(() => props.cases.length > 0 && props.cases.every((c) => selectedIds.value.has(c.id)));

function toggleOne(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}
function toggleAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(props.cases.map((c) => c.id));
}

function bulkAssign() {
  emit("bulkAssign", Array.from(selectedIds.value));
  selectedIds.value = new Set();
}
function bulkClose() {
  emit("bulkClose", Array.from(selectedIds.value));
  selectedIds.value = new Set();
}

function timeAgo(isoString?: string | null): string | null {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
</script>

<template>
  <div v-if="isLoading" class="flex flex-col items-center justify-center min-h-[300px]">
    <div class="w-8 h-8 border-2 rounded-full animate-spin mb-4" :style="{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }" />
    <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Loading cases…</span>
  </div>

  <EmptyState
    v-else-if="cases.length === 0"
    :title="totalCases === 0 ? 'No Cases yet' : 'Nothing matches these filters'"
    :description="totalCases === 0 ? 'Cases open automatically from Compliance Violations and inbound webhook triggers, or create one manually.' : 'Try a different status, severity, or clear \'My cases\'.'"
  />

  <template v-else>
    <div class="flex items-center justify-between mb-2">
      <label class="inline-flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" :checked="allSelected" @change="toggleAll" />
        Select all ({{ cases.length }})
      </label>
      <div v-if="selectedIds.size > 0" class="flex items-center gap-2">
        <span class="text-xs text-gray-400">{{ selectedIds.size }} selected</span>
        <button
          v-if="currentUserEmail"
          :disabled="!canBulkTriage"
          :title="!canBulkTriage ? notPermittedTitle : undefined"
          class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
          @click="bulkAssign"
        >
          Assign to me
        </button>
        <button
          :disabled="!canBulkTriage"
          :title="!canBulkTriage ? notPermittedTitle : undefined"
          class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
          :style="{ backgroundColor: PRIMARY_BLUE }"
          @click="bulkClose"
        >
          Close selected
        </button>
      </div>
    </div>

    <div class="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
      <div
        v-for="(c, i) in cases"
        :key="c.id"
        class="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        :class="i > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''"
      >
        <input type="checkbox" :checked="selectedIds.has(c.id)" class="shrink-0" @click.stop @change="toggleOne(c.id)" />
        <button class="flex items-center gap-3 flex-1 min-w-0 text-left" @click="emit('open', c)">
          <component :is="ICONS[(SOURCE_META[c.source]?.icon ?? 'Folder') as keyof typeof ICONS]" :size="15" weight="Linear" class="shrink-0 text-gray-400" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ c.title }}</p>
            <p class="text-xs truncate text-gray-400">
              {{ SOURCE_META[c.source]?.label ?? c.source }}{{ c.assignee ? ` · Assigned to ${c.assignee}` : " · Unassigned" }} · Updated {{ timeAgo(c.updatedAt) }}
            </p>
          </div>
          <MitreTagPills v-if="c.mitreTechniques?.length" :ids="c.mitreTechniques" :technique-by-id="techniqueById" :tactic-color="tacticColor" />
          <SlaBadge :sla-status="c.slaStatus" />
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0"
            :style="{ backgroundColor: `${(SEVERITY_META[c.severity] ?? { color: MUTED }).color}15`, color: (SEVERITY_META[c.severity] ?? { color: MUTED, label: c.severity }).color }"
          >
            {{ (SEVERITY_META[c.severity] ?? { label: c.severity }).label }}
          </span>
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0"
            :style="{ backgroundColor: `${(STATUS_META[c.status] ?? { color: MUTED }).color}15`, color: (STATUS_META[c.status] ?? { color: MUTED, label: c.status }).color }"
          >
            {{ (STATUS_META[c.status] ?? { label: c.status }).label }}
          </span>
        </button>
      </div>
    </div>
  </template>
</template>
