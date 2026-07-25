<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type InputType = 'text' | 'email' | 'password' | 'number' | 'search' | 'textarea' | 'select'

interface SelectOption {
  value: string
  label: string
}

interface Props {
  type?: InputType
  modelValue?: string | number
  label?: string
  helperText?: string
  error?: string
  placeholder?: string
  disabled?: boolean
  options?: SelectOption[]
  rows?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  options: () => [],
  rows: 3,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const baseInput = 'w-full px-3 py-2 border rounded-lg text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200 placeholder:text-gray-400'

const borderClass = computed(() =>
  props.error
    ? 'border-red-400 focus:ring-red-400'
    : 'border-gray-300 focus:ring-brand-500'
)

const inputClass = computed(() => cn(baseInput, borderClass.value, props.class))
const isSearch = computed(() => props.type === 'search')
</script>

<template>
  <div>
    <label v-if="label" class="block text-sm font-medium text-gray-700 mb-1">{{ label }}</label>

    <!-- Textarea -->
    <textarea
      v-if="type === 'textarea'"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :value="modelValue as string"
      :class="cn(baseInput, borderClass, 'resize-none', props.class)"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />

    <!-- Select -->
    <select
      v-else-if="type === 'select'"
      :disabled="disabled"
      :value="modelValue as string"
      :class="cn(baseInput, borderClass, 'cursor-pointer', props.class)"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>

    <!-- Search with icon -->
    <div v-else-if="isSearch" class="relative">
      <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <!-- Magnifer icon inline SVG -->
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </span>
      <input
        type="search"
        :placeholder="placeholder"
        :disabled="disabled"
        :value="modelValue as string"
        :class="cn(baseInput, borderClass, 'pl-9', props.class)"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- Standard input -->
    <input
      v-else
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :value="modelValue as string"
      :class="inputClass"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />

    <p v-if="error" class="mt-1.5 text-xs text-red-500">{{ error }}</p>
    <p v-else-if="helperText" class="mt-1.5 text-xs text-gray-400">{{ helperText }}</p>
  </div>
</template>
