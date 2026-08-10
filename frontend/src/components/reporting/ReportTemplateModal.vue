<script setup lang="ts">
// Custom HTML report template editor — a genuine modal, not a tab pane, in
// the original (App.jsx:6404-6430). The textarea binds straight to the
// live `customReportTemplate` value; both "Close" and "Apply & Save" just
// persist-and-close (there's no separate draft/save distinction upstream).
import { ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useDashboardStateStore } from "../../stores/dashboardState";
import { useUiStore } from "../../stores/ui";

const DANGER = "#EF4444";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useDashboardStateStore();
const ui = useUiStore();
const draft = ref("");
const isSaving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = store.customReportTemplate;
    }
  },
);

async function applyAndSave() {
  isSaving.value = true;
  try {
    await store.saveCustomReportTemplate(draft.value);
    emit("close");
  } finally {
    isSaving.value = false;
  }
}

// Port of the Reset button (App.jsx:6420) — a plain window.confirm(), same
// idiom used for every other destructive action in this app, not a custom
// two-click confirm state machine.
function resetToDefault() {
  if (window.confirm("Reset to default template?")) draft.value = "";
}

function close() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto" @click.self="close">
      <div class="w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl bg-white dark:bg-gray-800 flex flex-col">
        <div class="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div>
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">Custom HTML Template</h2>
            <p class="text-xs mt-1 text-gray-400">
              Use Jinja2 syntax to inject data (e.g., <code class="text-blue-500" v-pre>{{ Report_Title }}</code>). Leave blank to fall back to default.
            </p>
          </div>
          <button class="text-gray-400 hover:text-red-500 transition-colors" aria-label="Close" @click="close">
            <component :is="ICONS.CloseCircle" :size="20" weight="Linear" />
          </button>
        </div>

        <div class="p-6 overflow-hidden flex-1 flex flex-col bg-gray-50/50 dark:bg-black/20">
          <textarea
            v-model="draft"
            class="w-full flex-1 rounded-xl p-4 text-[12px] font-mono outline-none transition-colors border shadow-inner resize-none custom-scrollbar focus:border-blue-500 focus:ring-2 focus:ring-brand-500"
            :style="{ backgroundColor: ui.isDark ? '#0A0A0A' : '#FFFFFF', color: ui.isDark ? '#34D399' : '#0F172A', borderColor: ui.isDark ? '#374151' : '#E5E7EB' }"
            placeholder="<!DOCTYPE html>
<html>..."
            spellcheck="false"
          />
        </div>

        <div class="p-6 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3 shrink-0">
          <button class="px-5 py-2.5 rounded-lg font-bold text-sm transition-colors hover:bg-red-500/10" :style="{ color: DANGER }" @click="resetToDefault">Reset to Default</button>
          <div class="flex gap-3">
            <button class="px-5 py-2.5 rounded-lg font-medium text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5 text-gray-400" @click="close">Close</button>
            <button :disabled="isSaving" class="bg-[#0055FF] hover:bg-blue-600 px-8 py-2.5 rounded-xl font-bold text-sm text-white transition-colors shadow-md disabled:opacity-50" @click="applyAndSave">
              {{ isSaving ? "Saving…" : "Apply & Save" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
