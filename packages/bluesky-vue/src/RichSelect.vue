<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from './lib/utils'

export interface RichSelectOption {
  value: string
  label: string
  description?: string
  icon?: object
}

interface Props {
  options: RichSelectOption[]
  modelValue?: string
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select…',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const selected = computed(() => props.options.find(o => o.value === props.modelValue) ?? null)

function select(opt: RichSelectOption) {
  emit('update:modelValue', opt.value)
  open.value = false
}
</script>

<template>
  <div class="relative w-full">
    <button
      class="w-full flex items-center gap-3 px-3 py-2.5 border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
      @click="open = !open"
    >
      <div v-if="selected?.icon" class="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
        <component :is="selected.icon" :size="16" class="text-brand-600" />
      </div>
      <div class="flex-1 text-left">
        <template v-if="selected">
          <p class="text-sm text-gray-900">{{ selected.label }}</p>
          <p v-if="selected.description" class="text-xs text-gray-400">{{ selected.description }}</p>
        </template>
        <p v-else class="text-sm text-gray-400">{{ placeholder }}</p>
      </div>
      <!-- AltArrowDown -->
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" :class="cn('text-gray-400 transition-transform shrink-0', open && 'rotate-180')">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <template v-if="open">
      <div class="fixed inset-0 z-10" @click="open = false" />
      <div class="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
        <button
          v-for="opt in options"
          :key="opt.value"
          :class="cn('flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors', modelValue === opt.value ? 'bg-brand-50' : 'hover:bg-gray-50')"
          @click="select(opt)"
        >
          <div v-if="opt.icon" :class="cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', modelValue === opt.value ? 'bg-brand-100' : 'bg-gray-100')">
            <component :is="opt.icon" :size="16" :class="modelValue === opt.value ? 'text-brand-600' : 'text-gray-500'" />
          </div>
          <div class="flex-1">
            <p :class="cn('text-sm', modelValue === opt.value ? 'text-brand-700' : 'text-gray-900')">{{ opt.label }}</p>
            <p v-if="opt.description" class="text-xs text-gray-400">{{ opt.description }}</p>
          </div>
        </button>
      </div>
    </template>
  </div>
</template>
