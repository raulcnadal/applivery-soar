<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type ProgressColor = 'brand' | 'success' | 'warning' | 'danger' | 'neutral'
export type ProgressSize  = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface Props {
  value?: number
  size?: ProgressSize
  color?: ProgressColor
  label?: string
  showValue?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  color: 'brand',
  showValue: false,
})

const SIZE_CLASSES: Record<ProgressSize, string> = {
  xs: 'h-0.5',
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
  xl: 'h-4',
}

const TRACK_CLASSES: Record<ProgressColor, string> = {
  brand:   'bg-brand-100',
  success: 'bg-green-100',
  warning: 'bg-yellow-100',
  danger:  'bg-red-100',
  neutral: 'bg-gray-100',
}

const FILL_CLASSES: Record<ProgressColor, string> = {
  brand:   'bg-brand-600',
  success: 'bg-green-500',
  warning: 'bg-yellow-400',
  danger:  'bg-red-500',
  neutral: 'bg-gray-400',
}

const isIndeterminate = computed(() => props.value === undefined)
const clampedValue    = computed(() =>
  props.value !== undefined ? Math.min(100, Math.max(0, props.value)) : 0,
)
</script>

<template>
  <div :class="cn('w-full', props.class)">
    <div v-if="label || showValue" class="flex justify-between items-center mb-1.5">
      <span v-if="label" class="text-xs text-gray-500">{{ label }}</span>
      <span v-if="showValue && !isIndeterminate" class="text-xs text-gray-500">
        {{ Math.round(clampedValue) }}%
      </span>
    </div>

    <div
      :class="cn(
        'rounded-full overflow-hidden',
        SIZE_CLASSES[size],
        TRACK_CLASSES[color],
      )"
    >
      <!-- Indeterminate -->
      <div
        v-if="isIndeterminate"
        :class="cn('h-full w-1/3 rounded-full', FILL_CLASSES[color])"
        style="animation: progress-slide 1.4s ease-in-out infinite"
      />
      <!-- Determinate -->
      <div
        v-else
        :class="cn('h-full rounded-full transition-all duration-500', FILL_CLASSES[color])"
        :style="{ width: `${clampedValue}%` }"
      />
    </div>

    <style v-if="isIndeterminate">
      @keyframes progress-slide {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
    </style>
  </div>
</template>
