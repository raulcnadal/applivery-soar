<script setup lang="ts">
import { cn } from './lib/utils'

interface Props {
  title: string
  subtitle?: string
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <div :class="cn('flex items-center justify-between mb-4', props.class)">
    <div class="flex items-center gap-3">
      <div v-if="$slots.icon" class="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
        <slot name="icon" />
      </div>
      <div>
        <h3 class="text-sm font-semibold text-gray-900">{{ title }}</h3>
        <p v-if="subtitle" class="text-xs text-gray-400">{{ subtitle }}</p>
      </div>
    </div>
    <div v-if="$slots.action" class="shrink-0">
      <slot name="action" />
    </div>
  </div>
</template>
