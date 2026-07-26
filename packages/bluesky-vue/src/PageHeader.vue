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
  <div :class="cn('border-b border-gray-100 pb-6 mb-8', props.class)">
    <div class="flex items-start justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div v-if="badge" class="flex items-center gap-2 mb-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-light bg-brand-100 text-brand-700">
            {{ badge }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <h1 class="text-3xl font-semibold text-gray-900">{{ title }}</h1>
          <slot name="title-suffix" />
        </div>
        <p v-if="description" class="mt-2 text-gray-500 text-sm">{{ description }}</p>
      </div>
      <div v-if="$slots.action" class="shrink-0">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>
