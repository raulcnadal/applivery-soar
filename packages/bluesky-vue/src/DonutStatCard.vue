<script lang="ts">
export interface DonutSegment {
  label: string
  pct: number
  color: string
  count?: number
}

export function buildDonutSlices(
  segs: DonutSegment[],
  cx: number, cy: number, outerR: number, innerR: number,
) {
  let cumAngle = -Math.PI / 2
  return segs.map((seg) => {
    const start = cumAngle
    cumAngle += (seg.pct / 100) * 2 * Math.PI
    const end   = cumAngle
    const large = seg.pct > 50 ? 1 : 0
    const x1  = cx + outerR * Math.cos(start), y1  = cy + outerR * Math.sin(start)
    const x2  = cx + outerR * Math.cos(end),   y2  = cy + outerR * Math.sin(end)
    const ix1 = cx + innerR * Math.cos(start), iy1 = cy + innerR * Math.sin(start)
    const ix2 = cx + innerR * Math.cos(end),   iy2 = cy + innerR * Math.sin(end)
    return {
      ...seg,
      path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${outerR} ${outerR} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${ix2.toFixed(2)} ${iy2.toFixed(2)} A ${innerR} ${innerR} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)} Z`,
    }
  })
}

</script>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from './lib/utils'
import WidgetKebabMenu from './WidgetKebabMenu.vue'
import type { ChartStyle } from './WidgetKebabMenu.vue'

export interface DonutStatCardProps {
  label: string
  change: string
  direction: 'up' | 'down' | 'neutral'
  segments: DonutSegment[]
  dark?: boolean
}

const props = withDefaults(defineProps<DonutStatCardProps>(), {
  dark: false,
})

const emit = defineEmits<{
  info: []
}>()

const chartStyle = ref<ChartStyle>('donut')
const hovered    = ref<number | null>(null)

const slices   = computed(() => buildDonutSlices(props.segments, 80, 80, 70, 34))
const gapColor = computed(() => props.dark ? '#1f2937' : 'white')
const active   = computed(() => hovered.value !== null ? props.segments[hovered.value] : props.segments[0])

const trendColor = computed(() => ({
  up:      props.dark ? 'text-green-400' : 'text-green-600',
  down:    props.dark ? 'text-red-400'   : 'text-red-500',
  neutral: props.dark ? 'text-gray-400'  : 'text-gray-500',
}[props.direction]))
</script>

<template>
  <div :class="cn('relative rounded-2xl border p-5', dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200')">
    <div class="absolute top-4 right-4 flex items-center gap-0.5">
      <WidgetKebabMenu :dark="dark" initial-style="donut" @chart-style-change="chartStyle = $event" />
      <button
        :class="cn('p-1 rounded-lg transition-colors', dark ? 'text-gray-600 hover:text-gray-400 hover:bg-gray-700' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100')"
        aria-label="View analytics"
        @click="emit('info')"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </button>
    </div>

    <div class="flex items-center gap-2.5 mb-4">
      <div
        v-if="$slots.icon"
        :class="cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', dark ? 'bg-brand-950' : 'bg-brand-50')"
      >
        <slot name="icon" />
      </div>
      <p :class="cn('text-xs font-normal uppercase tracking-widest', dark ? 'text-gray-500' : 'text-gray-400')">
        {{ label }}
      </p>
    </div>

    <!-- Donut -->
    <div v-if="chartStyle === 'donut'" class="flex items-center gap-5 mb-4">
      <svg width="160" height="160" viewBox="0 0 160 160" class="shrink-0">
        <path
          v-for="(s, i) in slices"
          :key="i"
          :d="s.path"
          :fill="s.color"
          :stroke="gapColor"
          stroke-width="2"
          class="cursor-pointer transition-opacity duration-150"
          :style="{ opacity: hovered === null || hovered === i ? 1 : 0.3 }"
          @mouseenter="hovered = i"
          @mouseleave="hovered = null"
        />
        <text x="80" y="75" text-anchor="middle" :fill="dark ? '#9ca3af' : '#6b7280'" font-size="11" font-weight="600" letter-spacing="0.5">
          {{ active.label }}
        </text>
        <text x="80" y="95" text-anchor="middle" :fill="dark ? '#f9fafb' : '#111827'" font-size="22" font-weight="700">
          {{ active.pct }}%
        </text>
      </svg>
      <div class="flex flex-col gap-3 flex-1 min-w-0">
        <div
          v-for="(s, i) in segments"
          :key="s.label"
          :class="cn('flex items-center gap-2 min-w-0 transition-opacity duration-150', hovered !== null && hovered !== i ? 'opacity-30' : 'opacity-100')"
          @mouseenter="hovered = i"
          @mouseleave="hovered = null"
        >
          <div class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: s.color }" />
          <span :class="cn('text-xs flex-1 truncate', dark ? 'text-gray-400' : 'text-gray-500')">{{ s.label }}</span>
          <span :class="cn('text-xs font-semibold tabular-nums', dark ? 'text-white' : 'text-gray-900')">{{ s.pct }}%</span>
        </div>
      </div>
    </div>

    <!-- Bar -->
    <div v-else-if="chartStyle === 'bar'" class="flex flex-col gap-3 mb-4">
      <div v-for="s in segments" :key="s.label">
        <div class="flex justify-between mb-1">
          <span :class="cn('text-xs', dark ? 'text-gray-400' : 'text-gray-500')">{{ s.label }}</span>
          <span :class="cn('text-xs font-semibold', dark ? 'text-white' : 'text-gray-900')">{{ s.pct }}%</span>
        </div>
        <div :class="cn('h-2 rounded-full overflow-hidden', dark ? 'bg-gray-700' : 'bg-gray-100')">
          <div
            class="h-full rounded-full transition-all duration-500"
            :style="{ width: `${s.pct}%`, backgroundColor: s.color }"
          />
        </div>
      </div>
    </div>

    <!-- Line (vertical columns) -->
    <div v-else-if="chartStyle === 'line'" class="mb-4">
      <div class="flex items-end gap-3 h-[120px]">
        <div
          v-for="s in segments"
          :key="s.label"
          class="flex-1 flex flex-col items-center gap-1.5 h-full justify-end"
        >
          <span :class="cn('text-xs font-semibold tabular-nums', dark ? 'text-white' : 'text-gray-900')">{{ s.pct }}%</span>
          <div
            class="w-full rounded-t-sm transition-all duration-500"
            :style="{ height: `${s.pct}%`, backgroundColor: s.color, minHeight: '4px' }"
          />
        </div>
      </div>
      <div class="flex gap-3 mt-2">
        <div
          v-for="s in segments"
          :key="s.label"
          :class="cn('flex-1 text-center text-[10px] truncate', dark ? 'text-gray-500' : 'text-gray-400')"
        >
          {{ s.label }}
        </div>
      </div>
    </div>

    <div :class="cn('flex items-center gap-1 text-xs font-normal', trendColor)">
      <svg v-if="direction === 'up'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
      <svg v-if="direction === 'down'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      <span>{{ change }}</span>
      <span :class="cn('font-normal ml-0.5', dark ? 'text-gray-500' : 'text-gray-400')">vs last month</span>
    </div>
  </div>
</template>
