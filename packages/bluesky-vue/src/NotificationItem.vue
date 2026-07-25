<script setup lang="ts">
import { cn } from './lib/utils'

export interface NotificationItemData {
  title: string
  time: string
  read?: boolean
}

interface Props {
  title: string
  time: string
  read?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  read: false,
})

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <div
    :class="cn(
      'flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors',
      read ? 'bg-white border-gray-200' : 'bg-brand-50 border-brand-100',
      props.class,
    )"
    @click="emit('click')"
  >
    <span
      :class="cn(
        'w-2 h-2 rounded-full mt-1.5 shrink-0',
        read ? 'bg-gray-300' : 'bg-brand-600',
      )"
    />
    <div class="flex-1 min-w-0">
      <p :class="cn('text-sm', read ? 'text-gray-700' : 'font-medium text-gray-900')">
        {{ title }}
      </p>
      <p class="text-xs text-gray-400 mt-0.5">{{ time }}</p>
    </div>
  </div>
</template>
