<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

interface Props {
  count?: number
  max?: number
  dot?: boolean
  color?: 'red' | 'brand'
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  count: 0,
  max: 99,
  dot: false,
  color: 'red',
})

const colorMap: Record<'red' | 'brand', string> = {
  red:   'bg-red-500',
  brand: 'bg-brand-600',
}

const showBadge = computed(() => props.dot || (props.count ?? 0) > 0)
const displayCount = computed(() => (props.count ?? 0) > props.max ? `${props.max}+` : props.count)
const badgeColor = computed(() => colorMap[props.color])
</script>

<template>
  <div :class="cn('relative inline-flex', props.class)">
    <slot />
    <template v-if="showBadge">
      <span
        v-if="dot"
        :class="cn('absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white', badgeColor)"
      />
      <span
        v-else
        :class="cn('absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-semibold text-white px-1', badgeColor)"
      >
        {{ displayCount }}
      </span>
    </template>
  </div>
</template>
