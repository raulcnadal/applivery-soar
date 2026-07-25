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
  <div :class="cn('flex flex-col items-center justify-center py-16 px-6 text-center', props.class)">
    <div v-if="$slots.icon" class="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
      <slot name="icon" />
    </div>
    <p class="text-sm font-semibold text-gray-900 mb-1">{{ title }}</p>
    <p v-if="description" class="text-sm text-gray-400 max-w-xs">{{ description }}</p>
    <slot name="action">
      <!-- optional CTA -->
    </slot>
  </div>
</template>
