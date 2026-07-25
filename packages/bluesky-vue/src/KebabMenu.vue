<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from './lib/utils'

export interface KebabMenuItem {
  label: string
  icon?: object
  danger?: boolean
}

interface Props {
  items: KebabMenuItem[]
  align?: 'left' | 'right'
  className?: string
}

const props = withDefaults(defineProps<Props>(), {
  align: 'left',
})

const emit = defineEmits<{
  select: [label: string]
}>()

const open = ref(false)

const groups = computed(() => {
  const result: KebabMenuItem[][] = []
  let current: KebabMenuItem[] = []
  props.items.forEach((item) => {
    if (item.danger && current.length > 0) {
      result.push(current)
      current = [item]
    } else {
      current.push(item)
    }
  })
  if (current.length > 0) result.push(current)
  return result
})

function selectItem(item: KebabMenuItem) {
  emit('select', item.label)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      class="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      aria-label="More options"
      @click="open = !open"
    >
      <!-- MenuDots rotated 90deg -->
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="rotate-90">
        <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
      </svg>
    </button>
    <template v-if="open">
      <div class="fixed inset-0 z-10" @click="open = false" />
      <div :class="cn('absolute top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 overflow-hidden', align === 'right' ? 'right-0' : 'left-0')">
        <template v-for="(group, gi) in groups" :key="gi">
          <hr v-if="gi > 0" class="my-1 border-gray-100" />
          <button
            v-for="item in group"
            :key="item.label"
            :class="cn('flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors', item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50')"
            @click="selectItem(item)"
          >
            <component :is="item.icon" v-if="item.icon" :size="14" :class="item.danger ? 'text-red-400' : 'text-gray-400'" />
            {{ item.label }}
          </button>
        </template>
      </div>
    </template>
  </div>
</template>
