<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tertiary'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface Props {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  class?: string
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  type: 'button',
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const variantClasses: Record<ButtonVariant, string> = {
  primary:   'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500',
  secondary: 'bg-white dark:bg-gray-800 text-brand-700 dark:text-brand-300 border border-brand-700 dark:border-brand-400 hover:bg-gray-50 dark:hover:bg-gray-700 focus:ring-brand-500',
  ghost:     'bg-transparent text-brand-600 dark:text-brand-400 hover:bg-brand-600/10 focus:ring-brand-500',
  danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  tertiary:  'bg-brand-900 text-white hover:bg-brand-800 focus:ring-brand-500',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

const isDisabled = computed(() => props.disabled || props.loading)

const spinnerClass = computed(() =>
  props.variant === 'primary' || props.variant === 'danger' || props.variant === 'tertiary'
    ? 'border-2 border-white/30 border-t-white w-4 h-4'
    : 'border-2 border-brand-200 border-t-brand-600 w-4 h-4'
)

const buttonClass = computed(() =>
  cn(
    'inline-flex items-center gap-2 font-normal rounded-lg transition-all duration-200',
    'focus:outline-none focus:ring-2 focus:ring-offset-2',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    variantClasses[props.variant],
    sizeClasses[props.size],
    props.class,
  )
)
</script>

<template>
  <button
    :type="type"
    :disabled="isDisabled"
    :class="buttonClass"
    @click="emit('click', $event)"
  >
    <template v-if="loading">
      <span :class="cn('rounded-full animate-spin', spinnerClass)" />
      <slot />
    </template>
    <template v-else>
      <slot name="icon-left" />
      <slot />
      <slot name="icon-right" />
    </template>
  </button>
</template>
