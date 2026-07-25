<script setup lang="ts">
import { cn } from './lib/utils'

interface Props {
  title: string
  description?: string
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <div :class="cn('flex items-center justify-between mb-6', props.class)">
    <div>
      <h2 class="text-xl font-semibold text-gray-900">{{ title }}</h2>
      <p v-if="description" class="mt-0.5 text-sm text-gray-500">{{ description }}</p>
    </div>
    <div v-if="$slots.action" class="shrink-0">
      <slot name="action" />
    </div>
  </div>
</template>
