<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from './lib/utils'
import WidgetKebabMenu from './WidgetKebabMenu.vue'
import type { ChartStyle } from './WidgetKebabMenu.vue'

export type { ChartStyle }

export interface StatVariant {
  label: string
  value: string
  change: string
  direction: 'up' | 'down' | 'neutral'
  sparkline?: number[]
}

interface Props {
  stat: StatVariant
  dark?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  dark: false,
})

const emit = defineEmits<{
  info: []
}>()

const chartStyle = ref<ChartStyle>('bar')

function buildDonutSlices(
  segments: { label: string; pct: number; color: string }[],
  cx: number, cy: number, outerR: number, innerR: number,
) {
  let cumAngle = -Math.PI / 2
  return segments.map((seg) => {
    const start = cumAngle
    cumAngle += (seg.pct / 100) * 2 * Math.PI
    const end  = cumAngle
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

const hoveredBar = ref<number | null>(null)

const trendColor = computed(() => ({
  up:      props.dark ? 'text-green-400' : 'text-green-600',
  down:    props.dark ? 'text-red-400'   : 'text-red-500',
  neutral: props.dark ? 'text-gray-400'  : 'text-gray-500',
}[props.stat.direction]))

// Sparkline (bar chart)
const sparkMax = computed(() => {
  if (!props.stat.sparkline) return 1
  return Math.max(...props.stat.sparkline)
})

// MiniLineChart
function miniLinePts(data: number[]) {
  const W = 200, H = 40
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1
  return data.map((v, i) =>
    `${((i / (data.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * H * 0.85 - 3).toFixed(1)}`,
  ).join(' ')
}

function miniLineArea(data: number[]) {
  const W = 200, H = 40
  const pts = miniLinePts(data)
  return `0,${H} ${pts} ${W},${H}`
}

// MiniSparklineDonut
const donutData = computed(() => {
  if (!props.stat.sparkline) return null
  const data = props.stat.sparkline
  const max  = Math.max(...data)
  const last = data[data.length - 1]
  const rawPct  = Math.round((last / max) * 100)
  const pct     = Math.min(97, Math.max(3, rawPct))
  const positive = props.stat.direction !== 'down'
  const mainColor = positive ? '#1258ff' : '#f87171'
  const bgColor   = props.dark ? '#374151' : '#e5e7eb'
  const slices = buildDonutSlices(
    [{ label: 'val', pct, color: mainColor }, { label: 'rest', pct: 100 - pct, color: bgColor }],
    20, 20, 17, 10,
  )
  return { slices, rawPct }
})
</script>

<template>
  <div :class="cn('relative rounded-2xl border p-5', dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200')">
    <div class="absolute top-4 right-4 flex items-center gap-0.5">
      <WidgetKebabMenu :dark="dark" initial-style="bar" @chart-style-change="chartStyle = $event" />
      <button
        :class="cn('p-1 rounded-lg transition-colors', dark ? 'text-gray-600 hover:text-gray-400 hover:bg-gray-700' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100')"
        aria-label="View analytics"
        @click="emit('info')"
      >
        <!-- InfoCircle -->
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </button>
    </div>

    <div class="flex items-center gap-2.5 mb-3">
      <div
        v-if="$slots.icon"
        :class="cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', dark ? 'bg-brand-950' : 'bg-brand-50')"
      >
        <slot name="icon" />
      </div>
      <p :class="cn('text-xs font-normal uppercase tracking-widest', dark ? 'text-gray-500' : 'text-gray-400')">
        {{ stat.label }}
      </p>
    </div>

    <p :class="cn('text-3xl font-semibold mb-3', dark ? 'text-white' : 'text-gray-900')">{{ stat.value }}</p>

    <div v-if="stat.sparkline" class="mb-3">
      <!-- Bar sparkline -->
      <div v-if="chartStyle === 'bar'" class="relative flex items-end gap-px h-10">
        <div
          v-for="(v, i) in stat.sparkline"
          :key="i"
          class="relative flex-1 flex items-end group"
          style="height: 100%"
          @mouseenter="hoveredBar = i"
          @mouseleave="hoveredBar = null"
        >
          <div
            v-if="hoveredBar === i"
            class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 pointer-events-none"
          >
            <div :class="cn('px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap shadow-md', dark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white')">
              {{ v }}
            </div>
            <div :class="cn('mx-auto w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px]', dark ? 'border-t-gray-700' : 'border-t-gray-900')" />
          </div>
          <div
            :class="cn('w-full rounded-sm transition-opacity', stat.direction !== 'down' ? 'bg-brand-500' : (dark ? 'bg-red-500' : 'bg-red-400'))"
            :style="{ height: `${Math.max(10, (v / sparkMax) * 100)}%`, opacity: hoveredBar === i ? 1 : 0.35 + (i / (stat.sparkline.length - 1)) * 0.65 }"
          />
        </div>
      </div>

      <!-- Line sparkline -->
      <svg
        v-else-if="chartStyle === 'line'"
        width="100%"
        :viewBox="`0 0 200 40`"
        preserveAspectRatio="none"
        class="h-10 w-full"
      >
        <polygon
          :points="miniLineArea(stat.sparkline)"
          :fill="stat.direction !== 'down' ? '#1258ff' : '#f87171'"
          fill-opacity="0.12"
        />
        <polyline
          :points="miniLinePts(stat.sparkline)"
          fill="none"
          :stroke="stat.direction !== 'down' ? '#1258ff' : '#f87171'"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>

      <!-- Donut sparkline -->
      <div v-else-if="chartStyle === 'donut' && donutData" class="h-10 flex items-center gap-2.5">
        <svg width="40" height="40" viewBox="0 0 40 40" class="shrink-0">
          <path
            v-for="(s, i) in donutData.slices"
            :key="i"
            :d="s.path"
            :fill="s.color"
          />
        </svg>
        <div>
          <p :class="cn('text-sm font-semibold leading-none', dark ? 'text-white' : 'text-gray-900')">
            {{ donutData.rawPct }}%
          </p>
          <p :class="cn('text-[10px] mt-0.5', dark ? 'text-gray-500' : 'text-gray-400')">of peak</p>
        </div>
      </div>
    </div>

    <div :class="cn('flex items-center gap-1 text-xs font-normal', trendColor)">
      <!-- AltArrowUp -->
      <svg v-if="stat.direction === 'up'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
      <!-- AltArrowDown -->
      <svg v-if="stat.direction === 'down'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      <span>{{ stat.change }}</span>
      <span :class="cn('font-normal ml-0.5', dark ? 'text-gray-500' : 'text-gray-400')">vs last month</span>
    </div>
  </div>
</template>
