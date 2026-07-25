<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type AlertType = 'info' | 'success' | 'warning' | 'danger'
export type AlertVariant = 'block' | 'inline'

interface Props {
  type?: AlertType
  variant?: AlertVariant
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'info',
  variant: 'block',
})

const BLOCK_STYLES: Record<AlertType, string> = {
  info:    'flex items-start gap-3 px-4 py-3 rounded-xl border bg-brand-50 border-brand-200 text-brand-800',
  success: 'flex items-start gap-3 px-4 py-3 rounded-xl border bg-green-50 border-green-200 text-green-800',
  warning: 'flex items-start gap-3 px-4 py-3 rounded-xl border bg-amber-50 border-amber-200 text-amber-800',
  danger:  'flex items-start gap-3 px-4 py-3 rounded-xl border bg-red-50 border-red-200 text-red-800',
}

const INLINE_STYLES: Record<AlertType, string> = {
  info:    'inline-flex items-center gap-1.5 text-sm text-brand-600',
  success: 'inline-flex items-center gap-1.5 text-sm text-green-600',
  warning: 'inline-flex items-center gap-1.5 text-sm text-amber-600',
  danger:  'inline-flex items-center gap-1.5 text-sm text-red-600',
}

const BLOCK_ICON_STYLES: Record<AlertType, string> = {
  info:    'text-brand-600 shrink-0 mt-0.5',
  success: 'text-green-500 shrink-0 mt-0.5',
  warning: 'text-amber-500 shrink-0 mt-0.5',
  danger:  'text-red-500 shrink-0 mt-0.5',
}

const INLINE_ICON_STYLES: Record<AlertType, string> = {
  info:    'text-brand-600 shrink-0',
  success: 'text-green-600 shrink-0',
  warning: 'text-amber-600 shrink-0',
  danger:  'text-red-600 shrink-0',
}

// SVG paths for icons (InfoCircle, CheckCircle, DangerTriangle, DangerCircle)
const ICON_PATHS: Record<AlertType, string> = {
  info:    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-14v4m0 4h.01',
  success: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  warning: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01',
  danger:  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v4m0 4h.01',
}

const containerClass = computed(() =>
  cn(
    props.variant === 'inline' ? INLINE_STYLES[props.type] : BLOCK_STYLES[props.type],
    props.class,
  )
)
const iconClass = computed(() =>
  props.variant === 'inline' ? INLINE_ICON_STYLES[props.type] : BLOCK_ICON_STYLES[props.type]
)
const iconSize = computed(() => props.variant === 'inline' ? 14 : 18)
</script>

<template>
  <p v-if="variant === 'inline'" :class="containerClass">
    <span :class="iconClass">
      <svg :width="iconSize" :height="iconSize" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="ICON_PATHS[type]" />
      </svg>
    </span>
    <slot />
  </p>
  <div v-else :class="containerClass">
    <span :class="iconClass">
      <svg :width="iconSize" :height="iconSize" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="ICON_PATHS[type]" />
      </svg>
    </span>
    <p class="text-sm"><slot /></p>
  </div>
</template>
