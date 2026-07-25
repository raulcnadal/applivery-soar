<script setup lang="ts">
import { cn } from './lib/utils'
import NotificationItem from './NotificationItem.vue'
import type { NotificationItemData } from './NotificationItem.vue'

interface Props {
  notifications: NotificationItemData[]
  class?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  markAllRead: []
  itemClick: [index: number]
}>()
</script>

<template>
  <div
    :class="cn(
      'w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden',
      props.class,
    )"
  >
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
      <p class="text-sm font-semibold text-gray-900">Notifications</p>
      <button
        class="text-xs text-brand-600 hover:underline transition-colors"
        @click="emit('markAllRead')"
      >
        Mark all read
      </button>
    </div>

    <div class="divide-y divide-gray-100 max-h-80 overflow-y-auto">
      <p v-if="notifications.length === 0" class="px-4 py-6 text-sm text-center text-gray-400">
        No notifications
      </p>
      <NotificationItem
        v-for="(n, i) in notifications"
        v-else
        :key="i"
        :title="n.title"
        :time="n.time"
        :read="n.read"
        @click="emit('itemClick', i)"
      />
    </div>
  </div>
</template>
