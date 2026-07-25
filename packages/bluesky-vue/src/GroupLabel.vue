<script setup lang="ts">
import { cn } from './lib/utils'

interface Props {
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <p :class="cn('text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3', props.class)">
    <slot />
  </p>
</template>
