<script setup lang="ts">
// Small (i) button that opens the matching admin guide (docs/*.md, served
// via GET /api/help/:slug) in a modal — port of HelpIcon.jsx. Self-contained
// (owns its own open/close state), so wiring it into a view is one line:
//   <HelpIcon slug="workflows" />
//   <HelpIcon slug="settings" anchor="vulnerability-service" title="Vulnerability Service help" />
// `slug` must be one of HELP_DOC_SLUGS in backend/src/modules/help/help.controller.ts.
// `anchor` (optional) is a heading id inside that doc to scroll straight to.
import { ref } from "vue";
import HelpModal from "./HelpModal.vue";

withDefaults(defineProps<{ slug: string; anchor?: string | null; title?: string }>(), {
  anchor: null,
  title: "Help",
});

const open = ref(false);
</script>

<template>
  <button
    type="button"
    :title="title"
    :aria-label="title"
    class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 transition-colors shrink-0 text-gray-400"
    @click="open = true"
  >
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  </button>
  <HelpModal v-if="open" :slug="slug" :anchor="anchor" @close="open = false" />
</template>
