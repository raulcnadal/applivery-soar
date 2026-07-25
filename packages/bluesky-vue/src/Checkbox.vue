<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

interface Props {
  label?: string
  description?: string
  modelValue: boolean
  indeterminate?: boolean
  disabled?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  indeterminate: false,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [checked: boolean]
}>()

const labelClass = computed(() =>
  cn(
    'flex items-start gap-3',
    props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    props.class,
  )
)

const boxClass = computed(() =>
  cn(
    'w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-150',
    props.modelValue || props.indeterminate
      ? 'bg-brand-600 border-brand-600'
      : 'bg-white border-gray-300 hover:border-brand-400',
  )
)

function handleChange(e: Event) {
  if (!props.disabled) {
    emit('update:modelValue', (e.target as HTMLInputElement).checked)
  }
}
</script>

<template>
  <label :class="labelClass">
    <div class="relative shrink-0 mt-0.5">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        class="sr-only peer"
        @change="handleChange"
      />
      <div :class="boxClass">
        <!-- Indeterminate minus -->
        <svg v-if="indeterminate && !modelValue" width="10" height="2" viewBox="0 0 10 2" fill="none">
          <path d="M1 1h8" stroke="white" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <!-- Checked checkmark -->
        <svg v-else-if="modelValue" width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l3 3 5-6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>
    <div v-if="label || description">
      <p v-if="label" class="text-sm text-gray-700">{{ label }}</p>
      <p v-if="description" class="text-xs text-gray-400 mt-0.5">{{ description }}</p>
    </div>
  </label>
</template>
