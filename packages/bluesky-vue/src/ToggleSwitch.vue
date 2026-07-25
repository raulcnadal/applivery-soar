<script setup lang="ts">
import { cn } from './lib/utils'

interface Props {
  modelValue: boolean
  label?: string
  description?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const track = props.size === 'sm' ? 'w-7 h-4' : 'w-10 h-6'
const thumb = props.size === 'sm'
  ? 'w-3 h-3 top-0.5 left-0.5 peer-checked:translate-x-3'
  : 'w-4 h-4 top-1 left-1 peer-checked:translate-x-4'
</script>

<template>
  <label :class="cn('flex items-start gap-3', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')">
    <div class="relative shrink-0 mt-0.5">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        class="sr-only peer"
        @change="(e) => !disabled && emit('update:modelValue', (e.target as HTMLInputElement).checked)"
      />
      <div :class="cn(track, 'rounded-full transition-colors duration-200', modelValue ? 'bg-brand-600' : 'bg-gray-200')" />
      <div :class="cn('absolute rounded-full bg-white shadow transition-transform duration-200', thumb)" />
    </div>
    <div v-if="label || description">
      <p v-if="label" :class="cn('text-sm select-none', modelValue ? 'text-gray-900 font-normal' : 'text-gray-700')">{{ label }}</p>
      <p v-if="description" class="text-xs text-gray-500 mt-0.5 select-none">{{ description }}</p>
    </div>
  </label>
</template>
