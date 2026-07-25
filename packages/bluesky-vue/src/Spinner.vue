<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface Props {
  size?: SpinnerSize
  light?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  light: false,
})

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3 border-2',
  sm: 'w-4 h-4 border-2',
  md: 'w-5 h-5 border-2',
  lg: 'w-7 h-7 border-[3px]',
  xl: 'w-10 h-10 border-4',
}

const spinnerClass = computed(() =>
  cn(
    'rounded-full animate-spin',
    sizeClasses[props.size],
    props.light
      ? 'border-white/30 border-t-white'
      : 'border-brand-200 border-t-brand-600',
    props.class,
  )
)
</script>

<template>
  <div
    role="status"
    aria-label="Loading"
    :class="spinnerClass"
  />
</template>
