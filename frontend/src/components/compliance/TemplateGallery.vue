<script setup lang="ts">
// Compliance Policy Template gallery — port of TemplateGallery.jsx: a
// modal (not a persistent tab — see ComplianceView.vue's "New from
// Template" button), framework filter chips (All/ISO 27001/ENS/NIS2) each
// with its own scope-caveat callout, and a card per template that opens
// the Policy Builder pre-filled via templateToPolicyDraft.
import { Modal } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type ComplianceTemplate } from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";
const SEVERITY_COLORS: Record<string, string> = { low: "#64748B", medium: "#F59E0B", high: "#EF4444", critical: "#B91C1C" };
const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };
const PLATFORM_FILTERS = [
  { value: "all", label: "All platforms" },
  { value: "common", label: "Common" },
  { value: "windows", label: "Windows" },
  { value: "macos", label: "macOS" },
  { value: "apple", label: "iOS" },
  { value: "android", label: "Android" },
];

defineProps<{ open: boolean }>();
// `use-templates` always carries an array (even a single-template selection
// is just an array of 1) — a single unified-policy creation path instead of
// two, since merging one template's conditions is the same operation as
// merging six.
const emit = defineEmits<{ close: []; "use-templates": [templates: ComplianceTemplate[], frameworkLabel: string] }>();

const store = useComplianceStore();
const activeFramework = ref("all");
// Now that every template targets one specific OS (or is explicitly
// "Common"), the framework filter alone leaves 15-20+ cards visible at
// once -- this second dimension lets an admin jump straight to "just the
// Windows ones" the same way the Policy Builder itself is OS-first.
const activePlatform = ref("all");
const isLoading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  isLoading.value = true;
  error.value = null;
  try {
    await store.fetchTemplates();
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to load compliance templates.";
  } finally {
    isLoading.value = false;
  }
});

const frameworksByKey = computed(() => Object.fromEntries(store.frameworks.map((f: any) => [f.key, f])));
const visibleTemplates = computed(() =>
  store.templates.filter((t) => {
    if (activeFramework.value !== "all" && t.framework !== activeFramework.value) return false;
    if (activePlatform.value === "all") return true;
    if (activePlatform.value === "common") return !t.targetPlatform;
    return t.targetPlatform === activePlatform.value;
  }),
);

// Selection defaults to "everything currently visible" and resets to that
// whenever the framework/platform filter narrows or widens the list — this
// is what makes "select a certification, select a platform, get one policy
// covering everything relevant" the zero-extra-clicks path, while still
// letting an admin uncheck a specific aspect before creating the policy.
const selectedIds = ref<Set<string>>(new Set());
watch(visibleTemplates, (list) => { selectedIds.value = new Set(list.map((t) => t.id)); }, { immediate: true });

function toggle(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}
function selectAll() {
  selectedIds.value = new Set(visibleTemplates.value.map((t) => t.id));
}
function selectNone() {
  selectedIds.value = new Set();
}

// Merging only makes sense once both dimensions are narrowed to one
// concrete value — merging across "All frameworks" would blend near-
// duplicate controls from different certifications into one policy, and
// merging across "All platforms" would produce a policy whose
// targetPlatform can't be a single well-defined value.
const canMerge = computed(() => activeFramework.value !== "all" && activePlatform.value !== "all" && selectedIds.value.size > 0);

// Port of templateToPolicyDraft (TemplateGallery.jsx:16-26), extended to
// merge N selected templates into one policy draft instead of always being
// exactly one — deliberately id-less so PolicyBuilderDrawer's existing
// create path (no policy.id) handles it like any other new policy.
function createUnifiedPolicy() {
  if (!canMerge.value) return;
  const templates = visibleTemplates.value.filter((t) => selectedIds.value.has(t.id));
  if (!templates.length) return;
  const fw = (frameworksByKey.value as any)[activeFramework.value];
  emit("use-templates", templates, fw?.label || activeFramework.value);
}
</script>

<template>
  <Modal :open="open" size="lg" class="max-w-3xl" @close="emit('close')">
    <div class="flex items-center justify-between gap-2 mb-4 -mt-1">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Compliance Policy Templates</h3>
        <p class="text-xs mt-0.5 text-gray-400">
          Starting points mapped to well-known frameworks. Pick a certification and a platform, then merge the relevant templates into one unified policy for review.
        </p>
      </div>
      <button class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 shrink-0" @click="emit('close')">
        <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
      </button>
    </div>

    <div class="flex items-center gap-2 pb-3 mb-3 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
      <button
        class="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
        :class="activeFramework !== 'all' ? 'border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white' : ''"
        :style="activeFramework === 'all' ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : {}"
        @click="activeFramework = 'all'"
      >
        All frameworks
      </button>
      <button
        v-for="f in store.frameworks"
        :key="f.key"
        class="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
        :class="activeFramework !== f.key ? 'border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white' : ''"
        :style="activeFramework === f.key ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : {}"
        @click="activeFramework = f.key"
      >
        {{ (f as any).shortLabel || f.name }}
      </button>
    </div>

    <div class="flex items-center gap-2 pb-3 mb-3 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
      <button
        v-for="p in PLATFORM_FILTERS"
        :key="p.value"
        class="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
        :class="activePlatform !== p.value ? 'border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white' : ''"
        :style="activePlatform === p.value ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : {}"
        @click="activePlatform = p.value"
      >
        {{ p.label }}
      </button>
    </div>

    <div class="max-h-[60vh] overflow-y-auto">
      <div v-if="error" class="mb-4 px-3 py-2 rounded-lg text-xs font-medium flex items-start gap-2" style="background-color: #ef444412; color: #ef4444; border: 1px solid #ef444430">
        <component :is="ICONS.DangerTriangle" :size="14" weight="Linear" class="shrink-0 mt-0.5" /> {{ error }}
      </div>

      <p v-if="isLoading" class="text-xs text-gray-400">Loading templates…</p>

      <div v-if="!isLoading && activeFramework !== 'all' && (frameworksByKey as any)[activeFramework]?.caveats" class="mb-4 px-3 py-2 rounded-lg text-xs border text-gray-900 dark:text-white" :style="{ backgroundColor: `${PRIMARY_BLUE}08`, borderColor: `${PRIMARY_BLUE}25` }">
        <strong>Scope note:</strong> {{ (frameworksByKey as any)[activeFramework].caveats }}
      </div>

      <div v-if="!isLoading && visibleTemplates.length > 0" class="flex items-center gap-3 mb-3">
        <span class="text-xs font-medium text-gray-400">{{ selectedIds.size }} of {{ visibleTemplates.length }} selected</span>
        <button class="text-xs font-medium hover:opacity-70 transition-opacity" :style="{ color: PRIMARY_BLUE }" @click="selectAll">Select all</button>
        <button class="text-xs font-medium hover:opacity-70 transition-opacity" :style="{ color: PRIMARY_BLUE }" @click="selectNone">Select none</button>
      </div>

      <div class="space-y-3">
        <label
          v-for="t in visibleTemplates"
          :key="t.id"
          class="flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors"
          :class="selectedIds.has(t.id) ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50'"
        >
          <input type="checkbox" class="mt-1 shrink-0" :checked="selectedIds.has(t.id)" @change="toggle(t.id)" />
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
                {{ (frameworksByKey as any)[t.framework]?.shortLabel || t.framework }}
              </span>
              <span class="text-[10px] font-medium text-gray-400">{{ t.controlRef }}</span>
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase" :style="{ backgroundColor: `${SEVERITY_COLORS[t.severity] || SEVERITY_COLORS.medium}15`, color: SEVERITY_COLORS[t.severity] || SEVERITY_COLORS.medium }">
                {{ t.severity }}
              </span>
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" :style="{ backgroundColor: t.targetPlatform ? '#0241E312' : '#9CA3AF15', color: t.targetPlatform ? PRIMARY_BLUE : '#9CA3AF' }">
                {{ t.targetPlatform ? PLATFORM_LABELS[t.targetPlatform] ?? t.targetPlatform : "Common" }}
              </span>
            </div>
            <p class="text-sm font-medium mt-1.5 text-gray-900 dark:text-white">{{ t.title }}</p>
            <p class="text-xs mt-1 text-gray-400">{{ t.description }}</p>
          </div>
        </label>
        <p v-if="!isLoading && !error && visibleTemplates.length === 0" class="text-xs text-center py-8 text-gray-400">No templates for this framework yet.</p>
      </div>
    </div>

    <div class="flex items-center gap-3 pt-3 mt-3 border-t border-gray-200 dark:border-gray-700">
      <p class="text-xs text-gray-400">
        <template v-if="activeFramework === 'all' || activePlatform === 'all'">Pick a specific certification and platform above to merge templates into one policy.</template>
        <template v-else>Creates one policy covering all {{ selectedIds.size }} selected aspect{{ selectedIds.size === 1 ? "" : "s" }} — review conditions before enabling autoRun.</template>
      </p>
      <button
        :disabled="!canMerge"
        class="ml-auto shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        @click="createUnifiedPolicy"
      >
        <component :is="ICONS.ShieldCheck" :size="13" weight="Linear" /> Create unified policy
      </button>
    </div>
  </Modal>
</template>
