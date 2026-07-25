<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

interface Props {
  title?: string
  clickable?: boolean
  padding?: CardPadding
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  clickable: false,
  padding: 'md',
})

const emit = defineEmits<{
  click: []
}>()

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm:   'p-3',
  md:   'p-5',
  lg:   'p-8',
}

const hasHeader = computed(() => !!props.title || !!slots.action)
const slots = defineSlots<{
  default(): unknown
  action?(): unknown
}>()

const cardClass = computed(() =>
  cn(
    'bg-white border border-gray-200 rounded-xl',
    props.clickable && 'hover:border-brand-200 transition-all cursor-pointer',
    !hasHeader.value && paddingClasses[props.padding],
    props.class,
  )
)
</script>

<template>
  <div :class="cardClass" @click="emit('click')">
    <template v-if="hasHeader">
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h3 v-if="title" class="text-sm font-semibold text-gray-900">{{ title }}</h3>
        <div v-if="$slots.action">
          <slot name="action" />
        </div>
      </div>
      <div :class="paddingClasses[padding]">
        <slot />
      </div>
    </template>
    <template v-else>
      <slot />
    </template>
  </div>
</template>
