<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

interface Props {
  value: string
  modelValue: string
  label: string
  disabled?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isChecked = computed(() => props.value === props.modelValue)

const labelClass = computed(() =>
  cn(
    'flex items-center gap-3 group',
    props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    props.class,
  )
)

const circleClass = computed(() =>
  cn(
    'w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-150',
    isChecked.value
      ? 'border-brand-600 bg-white'
      : 'border-gray-300 bg-white group-hover:border-brand-400',
  )
)
</script>

<template>
  <label :class="labelClass">
    <div :class="circleClass">
      <div v-if="isChecked" class="w-2 h-2 rounded-full bg-brand-600" />
    </div>
    <input
      type="radio"
      :value="value"
      :checked="isChecked"
      :disabled="disabled"
      class="sr-only"
      @change="() => !disabled && emit('update:modelValue', value)"
    />
    <span class="text-sm text-gray-700">{{ label }}</span>
  </label>
</template>
