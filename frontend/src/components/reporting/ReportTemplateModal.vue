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
const saveError = ref<string | null>(null);
const isDownloadingDefault = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = store.customReportTemplate;
      saveError.value = null;
    }
  },
);

async function applyAndSave() {
  isSaving.value = true;
  saveError.value = null;
  try {
    await store.saveCustomReportTemplate(draft.value);
    emit("close");
  } catch (err: any) {
    // Server-side validation (validateCustomReportTemplate, reportTemplate.ts)
    // rejects a broken template with a 400 + a specific `detail` message —
    // surfaced here, inside the modal, rather than relying on
    // store.error/ReportingView's page-level banner, which sits BEHIND this
    // modal's own overlay and would be invisible while it's open.
    saveError.value = err?.response?.data?.detail || "Failed to save template.";
  } finally {
    isSaving.value = false;
  }
}

// Downloads the built-in default template's source (the actual supported
// Jinja2-subset grammar, not the live-Chart.js runtime markup a custom
// template can't use — see backend reportTemplate.ts's
// DEFAULT_CUSTOM_TEMPLATE_SOURCE doc comment) as a real starting point.
async function downloadDefaultTemplate() {
  isDownloadingDefault.value = true;
  try {
    const { api } = await import("../../api/http");
    const res = await api.get("/reports/template/default", { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "default-report-template.html";
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    isDownloadingDefault.value = false;
  }
}

const isPreviewing = ref(false);
const previewError = ref<string | null>(null);

// Opens a live render of whichever template is currently ACTIVE (the saved
// custom one if set, otherwise the built-in default) against sample data in
// a new tab. The preview endpoint sits behind verifyDashboardToken, which
// only reads the X-Dashboard-Token header (auth.middleware.ts) — a bare
// `window.open`/`<a href>` to it would 401 with no header attached, same
// reason compliance.ts's exportViolationsCsv/workflows.ts/cases.ts already
// go through the `api` client (whose request interceptor stamps that header)
// instead. Unlike those, this needs the *response itself* opened as a page,
// not downloaded — so a blank tab opens synchronously (inside the click
// handler, before the first await, so no browser treats it as a blocked
// popup) and its location is set to an object URL for the fetched HTML once
// the authenticated request resolves.
//
// Deliberately NOT passing "noopener": per spec (and Firefox in practice,
// always) a window.open() call with noopener set can return null for the
// reference itself, not just suppress the child page's window.opener —
// which silently broke this entirely (`if (win) ...` never ran, so the
// blank tab just sat there forever with no error, no matter what the
// template content was). There's no actual tab-nabbing risk to protect
// against here anyway: this tab never navigates to a third-party URL, only
// to a same-origin blob: URL this script creates itself, and we need the
// two-way reference specifically to set that location once the fetch
// resolves.
async function previewCurrentTemplate() {
  const win = window.open("", "_blank");
  // Belt-and-suspenders: a real popup blocker (as opposed to the noopener
  // footgun above) can still return null even for a synchronous, in-gesture
  // call, depending on the browser's own settings — surface that instead of
  // silently doing nothing, since there's no tab left to show an error in.
  if (!win) {
    previewError.value = "Your browser blocked the preview tab — allow popups for this site and try again.";
    return;
  }
  isPreviewing.value = true;
  previewError.value = null;
  try {
    const { api } = await import("../../api/http");
    const res = await api.get("/reports/template/preview", { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "text/html" }));
    win.location.href = url;
  } catch (err: any) {
    win.close();
    previewError.value = err?.response?.data?.detail || "Failed to load template preview.";
  } finally {
    isPreviewing.value = false;
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
            <div class="flex items-center gap-4 mt-2">
              <button
                type="button"
                :disabled="isDownloadingDefault"
                class="inline-flex items-center gap-1.5 text-xs font-medium hover:opacity-70 transition-opacity disabled:opacity-40 text-brand-600 dark:text-brand-400"
                @click="downloadDefaultTemplate"
              >
                <component :is="ICONS.Download" :size="13" weight="Linear" /> {{ isDownloadingDefault ? "Downloading…" : "Download default template" }}
              </button>
              <button
                type="button"
                :disabled="isPreviewing"
                class="inline-flex items-center gap-1.5 text-xs font-medium hover:opacity-70 transition-opacity disabled:opacity-40 text-brand-600 dark:text-brand-400"
                @click="previewCurrentTemplate"
              >
                <component :is="ICONS.Eye" :size="13" weight="Linear" /> {{ isPreviewing ? "Loading preview…" : "Preview current template" }}
              </button>
            </div>
          </div>
          <button class="text-gray-400 hover:text-red-500 transition-colors" aria-label="Close" @click="close">
            <component :is="ICONS.CloseCircle" :size="20" weight="Linear" />
          </button>
        </div>

        <div v-if="previewError" class="mx-6 mt-4 px-3 py-2 rounded-lg text-xs shrink-0" :style="{ backgroundColor: `${DANGER}10`, color: DANGER }">{{ previewError }}</div>

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

        <div v-if="saveError" class="mx-6 mb-0 px-3 py-2 rounded-lg text-xs shrink-0" :style="{ backgroundColor: `${DANGER}10`, color: DANGER }">{{ saveError }}</div>

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
