<script setup lang="ts">
import { ref } from 'vue'
import { cn } from './lib/utils'

export type ChartStyle = 'donut' | 'bar' | 'line'

interface Props {
  dark?: boolean
  initialStyle?: ChartStyle
}

const props = withDefaults(defineProps<Props>(), {
  dark: false,
  initialStyle: 'donut',
})

const emit = defineEmits<{
  chartStyleChange: [style: ChartStyle]
}>()

const open          = ref(false)
const chartExpanded = ref(false)
const activeStyle   = ref<ChartStyle>(props.initialStyle)

function toggleOpen() {
  open.value = !open.value
  chartExpanded.value = false
}

function selectStyle(style: ChartStyle) {
  activeStyle.value = style
  emit('chartStyleChange', style)
  open.value = false
  chartExpanded.value = false
}

const menuBg    = props.dark ? 'bg-gray-900 border-gray-700'    : 'bg-white border-gray-200'
const itemBase  = props.dark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-50'
const subBg     = props.dark ? 'bg-gray-800' : 'bg-gray-50'
const activeItem = props.dark ? 'text-brand-400 bg-brand-950/40' : 'text-brand-700 bg-brand-50'
</script>

<template>
  <div class="relative">
    <button
      :class="cn(
        'p-1 rounded-lg transition-colors',
        dark ? 'text-gray-600 hover:text-gray-400 hover:bg-gray-700' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100',
      )"
      aria-label="Widget options"
      @click="toggleOpen"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="rotate-90">
        <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
      </svg>
    </button>

    <template v-if="open">
      <div class="fixed inset-0 z-10" @click="() => { open = false; chartExpanded = false }" />
      <div :class="cn('absolute right-0 top-full mt-1 w-44 rounded-xl border shadow-lg z-20 py-1 overflow-hidden', menuBg)">
        <button :class="cn('flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors', itemBase)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>
            <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
          </svg>
          Move widget
        </button>
        <button :class="cn('flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors', itemBase)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Change widget
        </button>
        <hr :class="cn('my-1', dark ? 'border-gray-700' : 'border-gray-100')" />
        <button
          :class="cn('flex items-center justify-between w-full px-3 py-2 text-sm transition-colors', itemBase)"
          @click.stop="chartExpanded = !chartExpanded"
        >
          <span class="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            Chart style
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            :class="cn('transition-transform', chartExpanded && 'rotate-180')"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div v-if="chartExpanded" :class="cn('mx-1 mb-1 rounded-lg overflow-hidden', subBg)">
          <button
            v-for="style in (['donut', 'bar', 'line'] as ChartStyle[])"
            :key="style"
            :class="cn(
              'flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors capitalize',
              activeStyle === style ? activeItem : itemBase,
            )"
            @click.stop="selectStyle(style)"
          >
            {{ style }}
            <svg v-if="activeStyle === style" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
