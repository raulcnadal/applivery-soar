<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type PaginationVariant = 'numbered' | 'simple' | 'compact'

interface Props {
  page: number
  total: number
  variant?: PaginationVariant
  resultsText?: string
  siblings?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'numbered',
  siblings: 1,
})

const emit = defineEmits<{
  change: [page: number]
}>()

function buildPages(page: number, total: number, siblings: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const left  = Math.max(2, page - siblings)
  const right = Math.min(total - 1, page + siblings)
  const pages: (number | null)[] = [1]
  if (left > 2) pages.push(null)
  for (let i = left; i <= right; i++) pages.push(i)
  if (right < total - 1) pages.push(null)
  pages.push(total)
  return pages
}

const canPrev = computed(() => props.page > 1)
const canNext = computed(() => props.page < props.total)
const pages   = computed(() => buildPages(props.page, props.total, props.siblings))
</script>

<template>
  <!-- Simple -->
  <div v-if="variant === 'simple'" :class="cn('flex items-center justify-between w-full', props.class)">
    <p class="text-sm text-gray-500">{{ resultsText ?? `Page ${page} of ${total}` }}</p>
    <div class="flex items-center gap-2">
      <button
        :disabled="!canPrev"
        :class="cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 transition-colors',
          canPrev ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed',
        )"
        @click="canPrev && emit('change', page - 1)"
      >
        <!-- AltArrowLeft -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Previous
      </button>
      <button
        :disabled="!canNext"
        :class="cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 transition-colors',
          canNext ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed',
        )"
        @click="canNext && emit('change', page + 1)"
      >
        Next
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  </div>

  <!-- Compact -->
  <div v-else-if="variant === 'compact'" :class="cn('flex items-center gap-3', props.class)">
    <button
      :disabled="!canPrev"
      :class="cn(
        'w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors',
        canPrev ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed',
      )"
      @click="canPrev && emit('change', page - 1)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <span class="text-sm text-gray-600">
      Page <span class="font-semibold text-gray-900">{{ page }}</span> of {{ total }}
    </span>
    <button
      :disabled="!canNext"
      :class="cn(
        'w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors',
        canNext ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed',
      )"
      @click="canNext && emit('change', page + 1)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>

  <!-- Numbered (default) -->
  <div v-else :class="cn('flex items-center gap-1', props.class)">
    <button
      :disabled="!canPrev"
      :class="cn(
        'w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors',
        canPrev ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed',
      )"
      @click="canPrev && emit('change', page - 1)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>

    <template v-for="(p, i) in pages" :key="i">
      <span
        v-if="p === null"
        class="w-9 h-9 flex items-center justify-center text-gray-400 text-sm"
      >
        …
      </span>
      <button
        v-else
        :class="cn(
          'w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors',
          page === p ? 'bg-brand-600 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-50',
        )"
        @click="emit('change', p)"
      >
        {{ p }}
      </button>
    </template>

    <button
      :disabled="!canNext"
      :class="cn(
        'w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors',
        canNext ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed',
      )"
      @click="canNext && emit('change', page + 1)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>
</template>
