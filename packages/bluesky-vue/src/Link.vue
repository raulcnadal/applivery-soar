<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

type LinkVariant = 'default' | 'muted' | 'danger'
type LinkUnderline = 'always' | 'hover' | 'none'

interface Props {
  href?: string
  variant?: LinkVariant
  underline?: LinkUnderline
  external?: boolean
  arrow?: boolean
  disabled?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  underline: 'hover',
  external: false,
  arrow: false,
  disabled: false,
})

const variantClasses: Record<LinkVariant, string> = {
  default: 'text-brand-600 hover:text-brand-700',
  muted:   'text-gray-500 hover:text-gray-900',
  danger:  'text-red-600 hover:text-red-700',
}

const underlineClasses: Record<LinkUnderline, string> = {
  always: 'underline underline-offset-2',
  hover:  'hover:underline underline-offset-2',
  none:   '',
}

const linkClass = computed(() =>
  cn(
    'inline-flex items-center gap-1 text-sm transition-colors duration-200',
    variantClasses[props.variant],
    underlineClasses[props.underline],
    props.disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
    props.class,
  )
)

const externalAttrs = computed(() =>
  props.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
)
</script>

<template>
  <a
    :href="href"
    v-bind="externalAttrs"
    :class="linkClass"
  >
    <slot />
    <!-- External icon (ArrowRightUp) -->
    <svg v-if="external" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M7 7h10v10" />
    </svg>
    <!-- Arrow icon (AltArrowRight) -->
    <svg v-else-if="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  </a>
</template>
