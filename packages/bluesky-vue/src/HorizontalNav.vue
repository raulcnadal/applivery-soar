<script setup lang="ts">
import { cn } from './lib/utils'

export interface HorizontalNavItem {
  id: string
  label: string
}

interface Props {
  items: HorizontalNavItem[]
  modelValue: string
  logo?: string
  workspace?: string
  userInitials?: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  logo: '/applivery-logo.svg',
})

const emit = defineEmits<{
  'update:modelValue': [id: string]
  search: []
  notifications: []
}>()
</script>

<template>
  <nav :class="cn('bg-brand-600 w-full', props.class)">
    <div class="flex items-center h-16 px-4 gap-3">
      <!-- Logo -->
      <img :src="logo" alt="Logo" class="h-6 w-auto shrink-0" />
      <div class="w-px h-5 bg-white/20 shrink-0" />

      <!-- Nav items -->
      <div class="flex items-center gap-6 flex-1 min-w-0 overflow-hidden">
        <button
          v-for="item in items"
          :key="item.id"
          :title="item.label"
          :class="cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all whitespace-nowrap',
            modelValue === item.id
              ? 'bg-white/20 text-white font-medium'
              : 'text-white/70 hover:text-white hover:bg-white/10',
          )"
          @click="emit('update:modelValue', item.id)"
        >
          <slot :name="`icon-${item.id}`" />
          <span class="hidden min-[1470px]:inline">{{ item.label }}</span>
        </button>
      </div>

      <!-- Right actions -->
      <div class="flex items-center gap-0.5 shrink-0">
        <button
          aria-label="Search"
          class="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all"
          @click="emit('search')"
        >
          <!-- Magnifer icon inline SVG -->
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          aria-label="Notifications"
          class="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all"
          @click="emit('notifications')"
        >
          <!-- Bell icon inline SVG -->
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>

        <template v-if="workspace || userInitials">
          <div class="w-px h-5 bg-white/20 mx-1.5" />
          <button class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-all">
            <div v-if="workspace" class="text-right hidden min-[1200px]:block">
              <p class="text-[9px] font-semibold text-white/50 uppercase tracking-widest leading-none mb-0.5">
                Workspace
              </p>
              <p class="text-xs font-medium text-white leading-none">{{ workspace }}</p>
            </div>
            <div
              v-if="userInitials"
              class="w-7 h-7 rounded-full bg-brand-400 flex items-center justify-center text-white text-xs font-semibold shrink-0"
            >
              {{ userInitials.slice(0, 2).toUpperCase() }}
            </div>
          </button>
        </template>
      </div>
    </div>
  </nav>
</template>
