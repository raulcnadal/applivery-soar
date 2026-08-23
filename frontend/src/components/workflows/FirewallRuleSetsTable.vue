<script setup lang="ts">
// Firewall Policy Library — restyled to match DeviceFleetTable.vue's list
// experience (Devices main view): a toolbar with a search box, a sortable-
// column table on desktop, and a stacked card list on narrow screens
// (<768px, via useBreakpoint) — same split the other Workflows sub-view
// tables (WorkflowsTable.vue, ActionLibraryTable.vue) now use.
import { computed, ref } from "vue";
import { EmptyState } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useBreakpoint } from "../../composables/useBreakpoint";
import { useFirewallRuleSetsStore, type FirewallRuleSet } from "../../stores/firewallRuleSets";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const props = defineProps<{ ruleSets: FirewallRuleSet[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [FirewallRuleSet]; new: [] }>();

const store = useFirewallRuleSetsStore();
const { isMobile } = useBreakpoint();

function hasDefaultPosture(rs: FirewallRuleSet): boolean {
  return rs.defaultInboundAction !== "notConfigured" || rs.defaultOutboundAction !== "notConfigured";
}

const search = ref("");
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return props.ruleSets;
  return props.ruleSets.filter((rs) => rs.name.toLowerCase().includes(term) || (rs.description || "").toLowerCase().includes(term));
});

type SortKey = "name" | "rules";
const sortBy = ref<SortKey | null>(null);
const sortDir = ref<"asc" | "desc">("asc");

const sorted = computed(() => {
  if (!sortBy.value) return filtered.value;
  const key = sortBy.value;
  const dir = sortDir.value === "asc" ? 1 : -1;
  const copy = [...filtered.value];
  copy.sort((a, b) => {
    if (key === "name") return dir * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return dir * ((a.rules?.length || 0) - (b.rules?.length || 0));
  });
  return copy;
});

function toggleSort(key: SortKey) {
  if (sortBy.value !== key) {
    sortBy.value = key;
    sortDir.value = "asc";
  } else if (sortDir.value === "asc") {
    sortDir.value = "desc";
  } else {
    sortBy.value = null;
  }
}

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

    <EmptyState v-if="!isLoading && ruleSets.length === 0" title="Nothing in the library yet" description="Compose a named set of Windows Firewall rules — Isolate Device, Block Lateral Movement, etc. — to apply/restore from a workflow action." />
    <div v-else class="rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
      <!-- Toolbar -->
      <div class="p-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 border-b border-gray-200 dark:border-gray-700">
        <div class="relative flex-1 max-w-sm">
          <component :is="ICONS.Magnifer" :size="15" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
          <input
            v-model="search"
            type="text"
            placeholder="Search name, description…"
            class="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
          />
        </div>
        <span class="text-xs ml-auto shrink-0 text-gray-400">{{ filtered.length }} of {{ ruleSets.length }}</span>
      </div>

      <EmptyState v-if="filtered.length === 0" title="No rule sets match your search" description="Try a different search term." />

      <!-- Mobile — stacked cards -->
      <div v-else-if="isMobile" class="divide-y divide-gray-100 dark:divide-gray-800">
        <div v-for="rs in sorted" :key="rs.id" class="flex items-start gap-2.5 p-4">
          <component :is="ICONS.ShieldCheck" :size="14" weight="Linear" class="shrink-0 mt-0.5 text-gray-400" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-semibold truncate text-gray-900 dark:text-white">{{ rs.name }}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 bg-gray-100 dark:bg-gray-700 text-gray-400">{{ rs.rules?.length || 0 }} rule{{ (rs.rules?.length || 0) === 1 ? "" : "s" }}</span>
              <span v-if="rs.ensureFirewallEnabled" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">Enables Firewall</span>
              <span v-else class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }">Assumes EDR-managed</span>
              <span v-if="hasDefaultPosture(rs)" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25" :style="{ backgroundColor: `${DANGER}12`, color: DANGER }">Changes default posture</span>
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
      </div>

      <!-- Desktop — sortable column table -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm text-left">
          <thead class="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider">
                <button class="inline-flex items-center gap-1 uppercase tracking-wider" :style="{ color: sortBy === 'name' ? PRIMARY_BLUE : '#9CA3AF' }" @click="toggleSort('name')">
                  Name <component :is="ICONS.SortVertical" :size="11" weight="Linear" />
                </button>
              </th>
              <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider">
                <button class="inline-flex items-center gap-1 uppercase tracking-wider" :style="{ color: sortBy === 'rules' ? PRIMARY_BLUE : '#9CA3AF' }" @click="toggleSort('rules')">
                  Rules <component :is="ICONS.SortVertical" :size="11" weight="Linear" />
                </button>
              </th>
              <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Posture</th>
              <th class="px-3 py-2.5 w-20"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(rs, idx) in sorted" :key="rs.id" class="align-top" :class="idx > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''">
              <td class="px-3 py-3 max-w-[280px]">
                <div class="flex items-start gap-2">
                  <component :is="ICONS.ShieldCheck" :size="14" weight="Linear" class="shrink-0 mt-0.5 text-gray-400" />
                  <div class="min-w-0">
                    <p class="font-semibold truncate text-gray-900 dark:text-white">{{ rs.name }}</p>
                    <p v-if="rs.description" class="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{{ rs.description }}</p>
                  </div>
                </div>
              </td>
              <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">{{ rs.rules?.length || 0 }} rule{{ (rs.rules?.length || 0) === 1 ? "" : "s" }}</td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span v-if="rs.ensureFirewallEnabled" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 whitespace-nowrap" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">Enables Firewall</span>
                  <span v-else class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 whitespace-nowrap" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }">Assumes EDR-managed</span>
                  <span v-if="hasDefaultPosture(rs)" class="text-[10px] px-2 py-0.5 rounded-full font-light border border-current/25 whitespace-nowrap" :style="{ backgroundColor: `${DANGER}12`, color: DANGER }">Changes default posture</span>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-1 justify-end">
                  <button title="Edit" class="p-1.5 rounded-lg shrink-0 text-gray-400" @click="emit('edit', rs)">
                    <component :is="ICONS.Pen2" :size="13" weight="Linear" />
                  </button>
                  <button title="Remove" class="p-1.5 rounded-lg shrink-0" :style="{ color: DANGER }" @click="remove(rs)">
                    <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="p-3 border-t border-gray-200 dark:border-gray-700">
        <button class="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-400 hover:text-brand-600 hover:border-brand-500 transition-colors" @click="emit('new')">
          <component :is="ICONS.AddSquare" :size="13" weight="Linear" /> Add to library
        </button>
      </div>
    </div>

    <p class="inline-flex items-start gap-1.5 text-[10px] mt-4" :style="{ color: WARNING }">
      <component :is="ICONS.InfoCircle" :size="11" weight="Linear" class="shrink-0 mt-0.5" />
      Windows only. Restore only removes the rules tagged with this rule set — it isn't a full firewall snapshot, so the device's prior firewall state returns automatically once the tagged rules are gone, assuming nothing else changed the firewall in between.
    </p>
  </div>
</template>
