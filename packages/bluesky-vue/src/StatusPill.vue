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
  green:  'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  red:    'bg-red-100 text-red-700',
  brand:  'bg-brand-100 text-brand-700',
  purple: 'bg-purple-100 text-purple-700',
  gray:   'bg-gray-100 text-gray-600',
  orange: 'bg-orange-100 text-orange-700',
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
