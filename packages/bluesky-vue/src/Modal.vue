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
  size?: 'sm' | 'md' | 'lg'
  actions?: {
    cancel?: ActionItem
    confirm?: ActionItem & { variant?: 'primary' | 'danger' }
  }
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
})

const emit = defineEmits<{
  close: []
}>()

const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }

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
    <!-- z-[310] — deliberately above every bespoke full-screen overlay in
         the app (SettingsModal.vue/HelpModal.vue both z-[300], the highest
         found elsewhere) since Modal is teleported to <body> and can be
         opened from ANY context, including from inside those two — e.g.
         "New SOAR Role" from Settings. Both overlays end up as fixed-
         position siblings under <body> once teleported, so this is a
         plain numeric z-index comparison, not a stacking-context/nesting
         issue: whichever number is higher wins regardless of which one
         opened first or which is "inside" the other in the component tree. -->
    <div v-if="open" class="fixed inset-0 z-[310] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="emit('close')" />

      <!-- Panel -->
      <div :class="cn('relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full z-10', sizeClass[size], props.class)">
        <!-- Header -->
        <div v-if="title" class="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
          <h3 class="text-base font-medium text-gray-900 dark:text-white">{{ title }}</h3>
          <button
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
            @click="emit('close')"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
          </button>
        </div>

        <!-- Body -->
        <div :class="cn('px-6 py-5', !title && 'pt-6')">
          <slot />
        </div>

        <!-- Footer -->
        <div v-if="$slots.footer || actions" class="flex gap-3 justify-end px-6 pb-6">
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
              :class="cn(
                'inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-normal rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200',
                actions.confirm.variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  : 'bg-brand-600 hover:bg-brand-700 focus:ring-brand-500',
              )"
              @click="actions.confirm.onClick()"
            >
              {{ actions.confirm.label ?? 'Confirm' }}
            </button>
          </slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>
