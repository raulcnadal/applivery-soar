<script setup lang="ts">
// Custom HTML report template editor — a genuine modal, not a tab pane, in
// the original (App.jsx:6404-6430). The textarea binds straight to the
// live `customReportTemplate` value; both "Close" and "Apply & Save" just
// persist-and-close (there's no separate draft/save distinction upstream).
import { ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useDashboardStateStore } from "../../stores/dashboardState";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useDashboardStateStore();
const draft = ref("");
const isSaving = ref(false);
const resetConfirm = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = store.customReportTemplate;
      resetConfirm.value = false;
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

async function resetToDefault() {
  if (!resetConfirm.value) {
    resetConfirm.value = true;
    return;
  }
  draft.value = "";
  resetConfirm.value = false;
}

function close() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" @click.self="close">
      <div class="w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl bg-white dark:bg-gray-800 flex flex-col">
        <div class="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div>
            <h2 class="text-base font-bold leading-tight text-gray-900 dark:text-white">Custom HTML Template</h2>
            <p class="text-xs mt-0.5 text-gray-400">
              Optional Jinja2 template for generated reports — supports <code v-pre>{{ Workspace_Name }}</code>,
              <code v-pre>{{ Report_Title }}</code>, <code v-pre>{{ Generated_Date }}</code>, <code v-pre>{{ Time_Lapse }}</code>,
              a <code>metadata</code> loop, and a <code>report_sections</code> loop. Leave blank to use the default layout.
            </p>
          </div>
          <button class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 transition-colors shrink-0" aria-label="Close" @click="close">
            <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
          </button>
        </div>

        <div class="flex-1 p-6 overflow-hidden">
          <textarea
            v-model="draft"
            class="w-full h-full rounded-lg px-3 py-2 text-xs font-mono border border-gray-200 dark:border-gray-700 resize-none"
            placeholder="<html>…</html>"
          />
        </div>

        <div class="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 shrink-0">
          <button class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50" @click="resetToDefault">
            <component :is="ICONS.RestartCircle" :size="14" weight="Linear" />
            {{ resetConfirm ? "Click again to confirm" : "Reset to Default" }}
          </button>
          <div class="flex items-center gap-2">
            <button class="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5" @click="close">Close</button>
            <button :disabled="isSaving" class="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50" @click="applyAndSave">
              {{ isSaving ? "Saving…" : "Apply & Save" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
