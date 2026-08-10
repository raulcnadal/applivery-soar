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
    :class="cn('inline-flex gap-1 bg-gray-100 dark:bg-gray-900/50 rounded-xl p-1 max-w-full overflow-x-auto', props.class)"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="cn(
        'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
        modelValue === tab.id ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
      )"
      @click="emit('update:modelValue', tab.id)"
    >
      <slot :name="`icon-${tab.id}`" />
      {{ tab.label }}
      <span
        v-if="tab.badge !== undefined"
        :class="cn(
          'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium',
          modelValue === tab.id ? 'bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
        )"
      >
        {{ tab.badge }}
      </span>
    </button>
  </div>

  <!-- Underline variant -->
  <div
    v-else
    :class="cn('border-b border-gray-200 dark:border-gray-700 w-full', props.class)"
  >
    <div class="flex overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="cn(
          'relative flex items-center gap-1.5 px-4 pb-2.5 pt-1 text-sm font-normal transition-colors',
          modelValue === tab.id ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
        )"
        @click="emit('update:modelValue', tab.id)"
      >
        <slot :name="`icon-${tab.id}`" />
        {{ tab.label }}
        <span
          v-if="tab.badge !== undefined"
          :class="cn(
            'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium',
            modelValue === tab.id ? 'bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
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
