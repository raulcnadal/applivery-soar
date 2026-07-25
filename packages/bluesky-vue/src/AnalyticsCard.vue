<script setup lang="ts">
import { cn } from './lib/utils'

export type AnalyticsChangeType = 'positive' | 'negative' | 'neutral'

interface Props {
  label: string
  value: string
  change?: string
  changeType?: AnalyticsChangeType
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  changeType: 'neutral',
})

const changeBadgeClass: Record<AnalyticsChangeType, string> = {
  positive: 'bg-green-50 text-green-700',
  negative: 'bg-red-50 text-red-500',
  neutral:  'bg-gray-100 text-gray-500',
}

const slots = defineSlots<{
  icon?(): unknown
}>()
</script>

<template>
  <div :class="cn('bg-white rounded-2xl border border-gray-200 p-5', props.class)">
    <!-- With icon slot -->
    <template v-if="$slots.icon">
      <div class="flex items-center justify-between mb-4">
        <div class="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center">
          <slot name="icon" />
        </div>
        <span
          v-if="change"
          :class="cn('text-xs font-normal px-2 py-0.5 rounded-full', changeBadgeClass[changeType])"
        >
          {{ change }}
        </span>
      </div>
      <p class="text-3xl font-semibold text-gray-900 mb-1">{{ value }}</p>
      <p class="text-xs font-normal text-gray-400 uppercase tracking-widest">{{ label }}</p>
    </template>

    <!-- Without icon -->
    <template v-else>
      <div class="flex items-start justify-between gap-3 mb-3">
        <p class="text-sm font-normal text-gray-500">{{ label }}</p>
        <span
          v-if="change"
          :class="cn('text-xs font-normal px-2 py-0.5 rounded-full inline-flex items-center gap-1', changeBadgeClass[changeType])"
        >
          {{ change }}
        </span>
      </div>
      <p class="text-3xl font-semibold text-gray-900 mb-1">{{ value }}</p>
    </template>
  </div>
</template>
