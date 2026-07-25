<script setup lang="ts">
import { cn } from './lib/utils'

interface Props {
  label?: string
  dashed?: boolean
  vertical?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  dashed: false,
  vertical: false,
})
</script>

<template>
  <span v-if="vertical" :class="cn('h-5 w-px bg-gray-200 inline-block', props.class)" />
  <div v-else-if="label" :class="cn('flex items-center gap-3', props.class)">
    <span class="h-px flex-1 bg-gray-200" />
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-widest">{{ label }}</p>
    <span class="h-px flex-1 bg-gray-200" />
  </div>
  <hr
    v-else
    :class="cn('border-t border-gray-200', dashed && 'border-dashed', props.class)"
  />
</template>
