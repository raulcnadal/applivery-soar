<script setup lang="ts">
import { cn } from './lib/utils'

export interface Tab {
  id: string
  label: string
  badge?: number
}

export type TabsVariant = 'underline' | 'pill'

interface Props {
  tabs: Tab[]
  modelValue: string
  variant?: TabsVariant
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'underline',
})

const emit = defineEmits<{
  'update:modelValue': [id: string]
}>()
</script>

<template>
  <!-- Pill variant -->
  <div
    v-if="variant === 'pill'"
    :class="cn('inline-flex gap-1 bg-gray-100 rounded-xl p-1', props.class)"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="cn(
        'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
        modelValue === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
      )"
      @click="emit('update:modelValue', tab.id)"
    >
      <slot :name="`icon-${tab.id}`" />
      {{ tab.label }}
      <span
        v-if="tab.badge !== undefined"
        :class="cn(
          'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium',
          modelValue === tab.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-200 text-gray-500',
        )"
      >
        {{ tab.badge }}
      </span>
    </button>
  </div>

  <!-- Underline variant -->
  <div
    v-else
    :class="cn('border-b border-gray-200 w-full', props.class)"
  >
    <div class="flex">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="cn(
          'relative flex items-center gap-1.5 px-4 pb-2.5 pt-1 text-sm font-normal transition-colors',
          modelValue === tab.id ? 'text-brand-600' : 'text-gray-500 hover:text-gray-900',
        )"
        @click="emit('update:modelValue', tab.id)"
      >
        <slot :name="`icon-${tab.id}`" />
        {{ tab.label }}
        <span
          v-if="tab.badge !== undefined"
          :class="cn(
            'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium',
            modelValue === tab.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500',
          )"
        >
          {{ tab.badge }}
        </span>
        <span
          :class="cn(
            'absolute bottom-0 left-0 right-0 h-[2px] rounded-t-sm transition-colors',
            modelValue === tab.id ? 'bg-brand-600' : 'bg-transparent',
          )"
        />
      </button>
    </div>
  </div>
</template>
