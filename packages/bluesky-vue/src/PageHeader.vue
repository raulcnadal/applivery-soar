<script setup lang="ts">
import { cn } from './lib/utils'

interface Props {
  title: string
  description?: string
  badge?: string
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <div :class="cn('border-b border-gray-100 dark:border-gray-800 pb-6 mb-8', props.class)">
    <!-- Below md (768px): title and action stack vertically instead of
         sharing a row — every view's action slot (buttons, date pickers,
         etc.) otherwise has no room next to the title on a phone-width
         screen. At md and up this is unchanged from before: a single row,
         title left, action right. -->
    <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div v-if="badge" class="flex items-center gap-2 mb-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-light bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300">
            {{ badge }}
          </span>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900 dark:text-white">{{ title }}</h1>
          <slot name="title-suffix" />
        </div>
        <p v-if="description" class="mt-2 text-gray-500 dark:text-gray-400 text-sm">{{ description }}</p>
      </div>
      <div v-if="$slots.action" class="shrink-0">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>
