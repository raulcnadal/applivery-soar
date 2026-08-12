<script setup lang="ts">
// Full-featured markdown viewer for the in-app admin/developer guides —
// port of HelpModal.jsx. Cross-doc links inside the markdown (e.g.
// "settings.md#integrations") switch the modal to that doc in place instead
// of navigating away, with a small back-button history stack; same-doc
// "#anchor" links scroll within the modal. Opened via <HelpIcon /> — most
// call sites shouldn't need to use this directly.
import { nextTick, ref, watch } from "vue";
import { api } from "../../api/http";
import { DOC_TITLES, renderHelpDoc } from "../../lib/helpDocs";

const props = defineProps<{ slug: string; anchor?: string | null }>();
const emit = defineEmits<{ close: [] }>();

const slug = ref(props.slug);
const anchor = ref<string | null>(props.anchor ?? null);
const history = ref<Array<{ slug: string; anchor: string | null }>>([]);
const html = ref("");
const status = ref<"loading" | "ready" | "error">("loading");
const bodyRef = ref<HTMLElement | null>(null);

async function load() {
  status.value = "loading";
  try {
    const res = await api.get(`/help/${slug.value}`);
    html.value = renderHelpDoc(res.data?.content ?? "").html;
    status.value = "ready";
    if (bodyRef.value) bodyRef.value.scrollTop = 0;
    await nextTick();
    scrollToAnchor();
  } catch {
    status.value = "error";
  }
}

function scrollToAnchor() {
  if (!anchor.value || !bodyRef.value) return;
  requestAnimationFrame(() => {
    const el = bodyRef.value?.querySelector(`#${CSS.escape(anchor.value as string)}`);
    el?.scrollIntoView({ block: "start" });
  });
}

function navigateTo(targetSlug: string, targetAnchor: string | null) {
  history.value.push({ slug: slug.value, anchor: anchor.value });
  slug.value = targetSlug;
  anchor.value = targetAnchor || null;
}

function goBack() {
  const prev = history.value.pop();
  if (!prev) return;
  slug.value = prev.slug;
  anchor.value = prev.anchor;
}

function onBodyClick(e: MouseEvent) {
  const target = (e.target as HTMLElement)?.closest("a");
  if (!target) return;
  const docSlug = target.getAttribute("data-doc-slug");
  const docAnchor = target.getAttribute("data-doc-anchor");
  if (docSlug) {
    e.preventDefault();
    navigateTo(docSlug, docAnchor || null);
    return;
  }
  if (docAnchor !== null && target.getAttribute("href")?.startsWith("#")) {
    e.preventDefault();
    const el = bodyRef.value?.querySelector(`#${CSS.escape(docAnchor)}`);
    el?.scrollIntoView({ block: "start" });
  }
}

watch(slug, load, { immediate: true });
</script>

<template>
  <div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" @click.self="emit('close')">
    <div class="w-full max-w-3xl rounded-2xl shadow-xl overflow-hidden flex flex-col bg-white dark:bg-gray-800" style="max-height: 85vh">
      <div class="flex items-center gap-2 px-5 py-4 shrink-0 border-b border-gray-100 dark:border-gray-800">
        <button v-if="history.length > 0" type="button" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/5 shrink-0 text-gray-500 dark:text-gray-400" title="Back" @click="goBack">
          ←
        </button>
        <h3 class="text-sm font-semibold flex-1 truncate text-gray-900 dark:text-white">{{ DOC_TITLES[slug] || slug }}</h3>
        <button type="button" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/5 shrink-0 text-gray-500 dark:text-gray-400" title="Close" @click="emit('close')">
          ✕
        </button>
      </div>
      <div ref="bodyRef" class="overflow-y-auto flex-1 px-6 py-5" @click="onBodyClick">
        <div v-if="status === 'loading'" class="text-sm py-8 text-center text-gray-500 dark:text-gray-400">Loading guide…</div>
        <div v-else-if="status === 'error'" class="text-sm py-8 text-center text-gray-500 dark:text-gray-400">
          Couldn't load this guide. It may not be bundled in this deployment yet.
        </div>
        <div v-else class="help-doc-body text-sm" v-html="html" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* This is the one text sink in the app that renders via v-html into a
   scoped <style> block instead of Tailwind dark: classes or
   useUiStore().activeTheme, so it fully bypassed the Phase 11 dark-mode
   sweep — every rule below hardcoded a light-only hex. HelpIcon.vue opens
   this modal from nearly every view's "?" icon, so with the modal card
   itself already dark:bg-gray-800 (#1F2937), this rendered near-black
   headings/body text directly on a dark card. Paired :global(.dark)
   overrides added below, same color tokens (white/gray-300/gray-400/
   gray-700/gray-900) every other dark-mode surface in this app uses. */
.help-doc-body :deep(h1) { font-size: 1.125rem; font-weight: 600; margin: 1.5rem 0 0.75rem; color: #111827; }
.help-doc-body :deep(h1:first-child) { margin-top: 0; }
.help-doc-body :deep(h2) { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem; padding-top: 1rem; border-top: 1px solid #f3f4f6; color: #111827; }
.help-doc-body :deep(h2:first-child) { margin-top: 0; padding-top: 0; border-top: none; }
.help-doc-body :deep(h3) { font-size: 0.875rem; font-weight: 600; margin: 1rem 0 0.5rem; color: #111827; }
.help-doc-body :deep(h4) { font-size: 0.875rem; font-weight: 600; margin: 0.75rem 0 0.375rem; color: #111827; }
.help-doc-body :deep(p) { margin-bottom: 0.75rem; line-height: 1.6; color: #374151; }
.help-doc-body :deep(a) { text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; color: #0241e3; }
.help-doc-body :deep(ul) { list-style: disc; padding-left: 1.25rem; margin-bottom: 0.75rem; color: #374151; }
.help-doc-body :deep(ol) { list-style: decimal; padding-left: 1.25rem; margin-bottom: 0.75rem; color: #374151; }
.help-doc-body :deep(li) { margin-bottom: 0.25rem; line-height: 1.6; }
.help-doc-body :deep(strong) { font-weight: 600; color: #111827; }
.help-doc-body :deep(code) { font-size: 0.8125rem; font-family: ui-monospace, monospace; padding: 0.125rem 0.375rem; border-radius: 0.25rem; background: #f9fafb; color: #374151; }
.help-doc-body :deep(pre) { margin-bottom: 0.75rem; }
.help-doc-body :deep(pre code) { display: block; padding: 0.75rem; border-radius: 0.5rem; overflow-x: auto; border: 1px solid #e5e7eb; }
.help-doc-body :deep(blockquote) { border-left: 2px solid #e5e7eb; padding-left: 0.75rem; margin: 0.75rem 0; font-style: italic; color: #6b7280; }
.help-doc-body :deep(hr) { margin: 1.25rem 0; border-color: #e5e7eb; }
.help-doc-body :deep(table) { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.875rem; }
.help-doc-body :deep(th) { text-align: left; font-weight: 600; padding: 0.5rem 0.75rem; font-size: 0.75rem; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
.help-doc-body :deep(td) { padding: 0.5rem 0.75rem; vertical-align: top; border-top: 1px solid #f3f4f6; color: #374151; }
</style>

<!--
  Dark-mode overrides for .help-doc-body, split into their own PLAIN
  (unscoped) <style> block rather than living in the scoped block above
  with `:global(.dark) ... :deep(...)`.

  That combination was silently dropped by Vue's scoped-CSS compiler —
  confirmed against the live production build: grepping the compiled CSS
  for ".dark" + "help-doc-body" turned up zero rules, only the light-mode
  :deep() ones above (which don't combine :global with :deep and compiled
  fine). Whatever the exact interaction is between the two pseudo-selectors
  in this Vue/postcss version, the practical effect was that dark mode fell
  back to the light-mode colors — near-black heading/body text sitting
  directly on the modal's dark:bg-gray-800 card, unreadable (confirmed live
  via computed styles on soar.mi-labs.es: a heading's color computed to
  rgb(17,24,39), the light-mode #111827, with `.dark` present on <html>).

  A plain, unscoped block sidesteps the whole :global/:deep question: since
  .help-doc-body's content is injected via v-html, none of it carries this
  component's scope attribute regardless, so ordinary selectors here match
  exactly the same elements the scoped :deep() rules above target — no
  :deep()/:global() needed at all. `!important` on the color properties
  specifically (not layout/spacing) guards against the otherwise-equal
  specificity between "selector" here and "selector[data-v-x] rule" above
  ever landing in the wrong cascade order after a future edit or a chunking
  change moves these style blocks relative to each other.
-->
<style>
.dark .help-doc-body h1,
.dark .help-doc-body h2,
.dark .help-doc-body h3,
.dark .help-doc-body h4,
.dark .help-doc-body strong { color: #ffffff !important; }
.dark .help-doc-body h2 { border-top-color: #374151; }
.dark .help-doc-body p,
.dark .help-doc-body ul,
.dark .help-doc-body ol,
.dark .help-doc-body td { color: #d1d5db !important; }
.dark .help-doc-body a { color: #7aaaff !important; }
.dark .help-doc-body code { background: rgba(255, 255, 255, 0.06); color: #d1d5db !important; }
.dark .help-doc-body pre code { border-color: #374151; }
.dark .help-doc-body blockquote { border-left-color: #374151; color: #9ca3af !important; }
.dark .help-doc-body hr { border-color: #374151; }
.dark .help-doc-body th { color: #9ca3af !important; border-bottom-color: #374151; }
.dark .help-doc-body td { border-top-color: #374151; }
</style>
