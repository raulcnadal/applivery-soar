<script setup lang="ts">
import { cn } from './lib/utils'

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface Props {
  items: BreadcrumbItem[]
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <nav aria-label="Breadcrumb" :class="props.class">
    <ol class="flex items-center flex-wrap gap-1.5">
      <li
        v-for="(item, i) in items"
        :key="i"
        class="flex items-center gap-1.5"
      >
        <span v-if="i > 0" class="text-sm text-gray-300 select-none">/</span>
        <span
          v-if="i === items.length - 1"
          class="text-sm text-gray-400"
          aria-current="page"
        >
          {{ item.label }}
        </span>
        <a
          v-else-if="item.href"
          :href="item.href"
          :class="cn('text-sm text-gray-700 hover:text-gray-900 transition-colors')"
        >
          {{ item.label }}
        </a>
        <span v-else class="text-sm text-gray-700">{{ item.label }}</span>
      </li>
    </ol>
  </nav>
</template>
