<script setup lang="ts">
import { cn } from './lib/utils'

export interface NavItem {
  id: string
  label: string
  badge?: number
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

interface Props {
  items?: NavItem[]
  groups?: NavGroup[]
  modelValue: string
  class?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [id: string]
}>()
</script>

<template>
  <!-- Grouped -->
  <nav v-if="groups && groups.length > 0" :class="cn('space-y-4', props.class)">
    <div v-for="group in groups" :key="group.label">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-widest px-3 mb-1">
        {{ group.label }}
      </p>
      <div class="space-y-0.5">
        <button
          v-for="item in group.items"
          :key="item.id"
          :class="cn(
            'relative flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors',
            modelValue === item.id
              ? 'bg-brand-50 text-brand-700'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50',
          )"
          @click="emit('update:modelValue', item.id)"
        >
          <span
            v-if="modelValue === item.id"
            class="absolute left-0 top-1.5 bottom-1.5 w-[4px] rounded-r bg-brand-700"
          />
          <slot :name="`icon-${item.id}`" />
          <span class="flex-1 text-left">{{ item.label }}</span>
          <span
            v-if="item.badge !== undefined"
            :class="cn(
              'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium',
              modelValue === item.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500',
            )"
          >
            {{ item.badge }}
          </span>
        </button>
      </div>
    </div>
  </nav>

  <!-- Flat -->
  <nav v-else :class="cn('space-y-0.5', props.class)">
    <button
      v-for="item in items ?? []"
      :key="item.id"
      :class="cn(
        'relative flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors',
        modelValue === item.id
          ? 'bg-brand-50 text-brand-700'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50',
      )"
      @click="emit('update:modelValue', item.id)"
    >
      <span
        v-if="modelValue === item.id"
        class="absolute left-0 top-1.5 bottom-1.5 w-[4px] rounded-r bg-brand-700"
      />
      <slot :name="`icon-${item.id}`" />
      <span class="flex-1 text-left">{{ item.label }}</span>
      <span
        v-if="item.badge !== undefined"
        :class="cn(
          'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium',
          modelValue === item.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500',
        )"
      >
        {{ item.badge }}
      </span>
    </button>
  </nav>
</template>
