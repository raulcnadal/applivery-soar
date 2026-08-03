<script setup lang="ts">
// Checkbox picker grouped by tactic, with a name/id search filter and a
// catalog-freshness footer — port of MitreTagPicker
// (shared/MitreCatalog.jsx:130-208). Used by CaseDetailDrawer's editable
// MITRE tag section.
import { computed, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import type { MitreTacticDef, MitreTechniqueDef } from "../../lib/mitreCatalog";
import type { MitreCatalogMeta } from "../../stores/compliance";

const props = defineProps<{
  techniques: MitreTechniqueDef[];
  tactics: MitreTacticDef[];
  tacticColor: Record<string, string>;
  selected: string[];
  catalogMeta?: MitreCatalogMeta | null;
  canRefreshCatalog?: boolean;
}>();

const emit = defineEmits<{ change: [ids: string[]]; refresh: [] }>();

const search = ref("");
const isRefreshing = ref(false);

const bySearch = computed(() => {
  if (!search.value.trim()) return props.techniques;
  const term = search.value.trim().toLowerCase();
  return props.techniques.filter((t) => t.id.toLowerCase().includes(term) || t.name.toLowerCase().includes(term));
});

const grouped = computed(() => {
  const byTactic: Record<string, MitreTechniqueDef[]> = {};
  bySearch.value.forEach((t) => {
    (byTactic[t.tactic] ??= []).push(t);
  });
  return props.tactics.map((tac) => ({ ...tac, techniques: byTactic[tac.key] ?? [] })).filter((tac) => tac.techniques.length > 0);
});

function toggle(id: string) {
  const next = props.selected.includes(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id];
  emit("change", next);
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
  return `${Math.floor(hours / 24)}d ago`;
}

async function handleRefresh() {
  isRefreshing.value = true;
  try {
    emit("refresh");
  } finally {
    isRefreshing.value = false;
  }
}
</script>

<template>
  <div class="rounded-lg border border-gray-200">
    <div class="p-2 flex items-center gap-2 border-b border-gray-200">
      <component :is="ICONS.Magnifer" :size="12" weight="Linear" class="shrink-0 text-gray-400" />
      <input v-model="search" placeholder="Filter techniques…" class="flex-1 text-xs outline-none bg-transparent text-gray-900" />
      <button v-if="selected.length > 0" type="button" class="text-[10px] font-semibold shrink-0 text-gray-400" @click="emit('change', [])">Clear ({{ selected.length }})</button>
    </div>
    <div class="max-h-56 overflow-y-auto p-2 space-y-2">
      <div v-for="tac in grouped" :key="tac.key">
        <p class="text-[10px] font-bold uppercase tracking-wider mb-1 px-1" :style="{ color: tacticColor[tac.key] || '#9CA3AF' }">{{ tac.name }}</p>
        <div class="space-y-0.5">
          <label
            v-for="t in tac.techniques"
            :key="t.id"
            class="flex items-center gap-2 px-1.5 py-1 rounded-md text-xs cursor-pointer"
            :class="selected.includes(t.id) ? 'bg-gray-50' : ''"
          >
            <input type="checkbox" :checked="selected.includes(t.id)" @change="toggle(t.id)" />
            <span class="font-mono text-[10px] shrink-0 text-gray-400">{{ t.id }}</span>
            <span :class="t.revoked ? 'line-through text-red-500' : 'text-gray-900'">{{ t.name }}</span>
            <span
              v-if="t.revoked"
              title="MITRE has revoked this technique ID upstream — kept selectable only so existing tags on old Policies/Cases still render, but shouldn't be applied to new ones."
              class="text-[9px] font-semibold px-1 py-0.5 rounded-full shrink-0"
              style="background-color: #ef444415; color: #ef4444"
            >
              revoked
            </span>
            <span
              v-else-if="t.deprecated"
              title="MITRE has deprecated this technique ID upstream, usually in favor of a newer/more specific one."
              class="text-[9px] font-semibold px-1 py-0.5 rounded-full shrink-0"
              style="background-color: #f59e0b15; color: #f59e0b"
            >
              deprecated
            </span>
          </label>
        </div>
      </div>
      <p v-if="grouped.length === 0" class="text-xs text-center py-4 text-gray-400">No techniques match "{{ search }}"</p>
    </div>
    <div v-if="catalogMeta" class="px-2 py-1.5 flex items-center justify-between gap-2 text-[10px] border-t border-gray-200 text-gray-400">
      <span>
        {{
          catalogMeta.lastFetchedAt
            ? `Cross-checked against MITRE's live catalog ${timeAgo(catalogMeta.lastFetchedAt)} (${catalogMeta.techniqueCount} techniques)`
            : catalogMeta.lastError
              ? `Live sync unavailable (${catalogMeta.lastError}) — showing curated names only`
              : "Not yet cross-checked against MITRE's live catalog — showing curated names only"
        }}
      </span>
      <button v-if="canRefreshCatalog" type="button" :disabled="isRefreshing" class="font-semibold shrink-0 disabled:opacity-50 text-gray-700" @click="handleRefresh">
        {{ isRefreshing ? "Syncing…" : "Sync now" }}
      </button>
    </div>
  </div>
</template>
