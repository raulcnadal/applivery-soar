<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type PillColor = 'green' | 'yellow' | 'red' | 'brand' | 'purple' | 'gray' | 'orange'
export type PillVariant = 'dot' | 'icon' | 'plain'

interface Props {
  label: string
  color?: PillColor
  variant?: PillVariant
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  color: 'gray',
  variant: 'dot',
})

const colorClasses: Record<PillColor, string> = {
  green:  'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
  yellow: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  red:    'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  brand:  'bg-brand-100 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300',
  purple: 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400',
  gray:   'bg-gray-100 dark:bg-gray-500/15 text-gray-600 dark:text-gray-400',
  orange: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400',
}

const pillClass = computed(() =>
  cn(
    'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-light border border-current/25',
    colorClasses[props.color],
    props.class,
  )
)
</script>

<template>
  <span :class="pillClass">
    <span v-if="variant === 'dot'" class="w-1.5 h-1.5 rounded-full bg-current" />
    <slot v-else-if="variant === 'icon'" name="icon" />
    {{ label }}
  </span>
</template>
