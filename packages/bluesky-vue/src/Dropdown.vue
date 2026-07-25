<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { cn } from './lib/utils'

export interface DropdownOption {
  value: string
  label: string
}

interface Props {
  options: DropdownOption[]
  modelValue: string
  placeholder?: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select...',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isOpen     = ref(false)
const alignRight = ref(false)
const containerRef = ref<HTMLDivElement | null>(null)

const selected = computed(() => props.options.find((o) => o.value === props.modelValue))

function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    alignRight.value = rect.right > window.innerWidth - 8
  }
}

function select(value: string) {
  emit('update:modelValue', value)
  isOpen.value = false
}

function handleClickOutside(e: MouseEvent | TouchEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('touchstart', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('touchstart', handleClickOutside)
})
</script>

<template>
  <div ref="containerRef" :class="cn('relative', props.class)">
    <button
      type="button"
      :class="cn(
        'w-full px-3 py-2.5 flex items-center justify-between border rounded-lg text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-all duration-200',
        isOpen
          ? 'border-brand-500 ring-1 ring-brand-500 ring-offset-0'
          : 'border-gray-300 hover:border-gray-400',
      )"
      @click="toggle"
    >
      <span :class="selected ? 'text-gray-900' : 'text-gray-400'">
        {{ selected ? selected.label : placeholder }}
      </span>
      <!-- AltArrowDown -->
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        :class="cn('text-gray-500 transition-transform duration-200', isOpen && 'rotate-180')"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div
      v-if="isOpen"
      :class="cn(
        'absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto',
        alignRight ? 'right-0' : 'left-0',
      )"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :class="cn(
          'w-full px-3 py-3 flex items-center justify-between text-sm hover:bg-gray-50 transition-colors',
          option.value === modelValue ? 'text-brand-600 bg-brand-50' : 'text-gray-900',
        )"
        @click="select(option.value)"
      >
        <span>{{ option.label }}</span>
        <!-- CheckCircle -->
        <svg
          v-if="option.value === modelValue"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="text-brand-600"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </button>
    </div>
  </div>
</template>
