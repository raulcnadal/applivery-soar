<script setup lang="ts">
import { cn } from './lib/utils'

export interface ButtonGroupOption {
  value: string
  label: string
}

interface Props {
  options: ButtonGroupOption[]
  modelValue: string
  class?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div :class="cn('inline-flex rounded-lg overflow-hidden border border-gray-200 divide-x divide-gray-200', props.class)">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="cn(
        'px-4 py-2 text-sm font-normal transition-colors',
        modelValue === option.value
          ? 'bg-brand-600 text-white'
          : 'bg-white text-gray-700 hover:bg-gray-50',
      )"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
