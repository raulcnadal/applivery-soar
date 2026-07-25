<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

interface Props {
  modelValue: boolean
  label?: string
  description?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [checked: boolean]
}>()

const isMd = computed(() => props.size === 'md')

const labelClass = computed(() =>
  cn(
    'flex items-center gap-3',
    props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    props.class,
  )
)

const trackClass = computed(() =>
  cn(
    'rounded-full transition-colors duration-200',
    isMd.value ? 'w-10 h-6' : 'w-8 h-5',
    props.modelValue ? 'bg-brand-600' : 'bg-gray-200',
  )
)

const thumbClass = computed(() =>
  cn(
    'absolute top-1 left-1 rounded-full bg-white shadow transition-transform duration-200',
    isMd.value ? 'w-4 h-4' : 'w-3 h-3',
    props.modelValue ? (isMd.value ? 'translate-x-4' : 'translate-x-3') : 'translate-x-0',
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
    <div class="relative shrink-0">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        class="sr-only peer"
        @change="handleChange"
      />
      <div :class="trackClass" />
      <div :class="thumbClass" />
    </div>
    <div v-if="label || description">
      <span v-if="label" class="text-sm text-gray-700">{{ label }}</span>
      <p v-if="description" class="text-xs text-gray-400 mt-0.5">{{ description }}</p>
    </div>
  </label>
</template>
