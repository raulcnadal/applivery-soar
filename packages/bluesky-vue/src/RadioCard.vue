<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

interface Props {
  value: string
  modelValue: string
  label: string
  description?: string
  class?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isSelected = computed(() => props.value === props.modelValue)

const cardClass = computed(() =>
  cn(
    'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all',
    isSelected.value ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300',
    props.class,
  )
)

const circleClass = computed(() =>
  cn(
    'shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-150',
    isSelected.value ? 'border-brand-600 bg-white' : 'border-gray-300 bg-white',
  )
)
</script>

<template>
  <label :class="cardClass">
    <input
      type="radio"
      :value="value"
      :checked="isSelected"
      class="sr-only"
      @change="emit('update:modelValue', value)"
    />
    <div v-if="$slots.icon" class="shrink-0 mt-0.5">
      <slot name="icon" />
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-gray-900">{{ label }}</p>
      <p v-if="description" class="text-xs text-gray-500 mt-0.5">{{ description }}</p>
    </div>
    <div :class="circleClass">
      <div v-if="isSelected" class="w-2 h-2 rounded-full bg-brand-600" />
    </div>
  </label>
</template>
