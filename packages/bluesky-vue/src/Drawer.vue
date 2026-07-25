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
    <div v-if="open" class="fixed inset-0 z-[200]">
      <!-- Backdrop -->
      <div class="fixed inset-0 z-40 bg-black/40" @click="emit('close')" />

      <!-- Panel -->
      <div
        :class="cn(
          'fixed inset-y-0 z-50 bg-white flex flex-col',
          width,
          side === 'right' ? 'right-0 rounded-l-2xl shadow-2xl' : 'left-0 rounded-r-2xl shadow-2xl',
          props.class,
        )"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 class="text-base font-semibold text-gray-900">{{ title ?? '' }}</h3>
          <button
            class="p-2 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
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
        <div v-if="$slots.footer || actions" class="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <slot name="footer">
            <button
              v-if="actions?.cancel"
              class="inline-flex items-center gap-2 px-4 py-2 bg-white text-brand-700 text-sm font-normal rounded-lg border border-brand-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-all duration-200"
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
