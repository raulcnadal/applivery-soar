<script setup lang="ts">
import { watch, onUnmounted } from 'vue'
import { cn } from './lib/utils'

interface ActionItem {
  label?: string
  onClick: () => void
}

interface Props {
  open: boolean
  title?: string
  side?: 'right' | 'left'
  width?: string
  actions?: {
    cancel?: ActionItem
    confirm?: ActionItem
  }
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  side: 'right',
  width: 'w-96',
})

const emit = defineEmits<{
  close: []
}>()

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      window.addEventListener('keydown', onKeyDown)
    } else {
      window.removeEventListener('keydown', onKeyDown)
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <!-- z-[310] — same reasoning as Modal.vue: teleported to <body>, so it
         needs to be able to render above SettingsModal.vue/HelpModal.vue
         (both z-[300]) when opened from within them, and this is a plain
         numeric comparison between fixed-position siblings under <body>,
         not a nesting issue. -->
    <div v-if="open" class="fixed inset-0 z-[310]">
      <!-- Backdrop -->
      <div class="fixed inset-0 z-40 bg-black/40" @click="emit('close')" />

      <!-- Panel -->
      <div
        :class="cn(
          // max-w-[100vw] caps whatever fixed width a caller passes (most
          // pass a plain px/rem Tailwind width class, e.g. w-96 or w-[480px],
          // sized for a desktop panel) so it can never overrun a phone-width
          // viewport — a no-op at desktop widths, since no drawer's fixed
          // width is anywhere close to 100vw there.
          'fixed inset-y-0 z-50 bg-white dark:bg-gray-800 flex flex-col max-w-[100vw]',
          width,
          side === 'right' ? 'right-0 rounded-l-2xl shadow-2xl' : 'left-0 rounded-r-2xl shadow-2xl',
          props.class,
        )"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ title ?? '' }}</h3>
          <button
            class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
            @click="emit('close')"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-6">
          <slot />
        </div>

        <!-- Footer -->
        <div v-if="$slots.footer || actions" class="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex gap-3 justify-end">
          <slot name="footer">
            <button
              v-if="actions?.cancel"
              class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 text-brand-700 dark:text-brand-300 text-sm font-normal rounded-lg border border-brand-700 dark:border-brand-400 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-all duration-200"
              @click="actions.cancel.onClick()"
            >
              {{ actions.cancel.label ?? 'Cancel' }}
            </button>
            <button
              v-if="actions?.confirm"
              class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-normal rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-all duration-200"
              @click="actions.confirm.onClick()"
            >
              {{ actions.confirm.label ?? 'Save' }}
            </button>
          </slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>
