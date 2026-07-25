<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from './lib/utils'
import WidgetKebabMenu from './WidgetKebabMenu.vue'
import type { ChartStyle } from './WidgetKebabMenu.vue'

interface Props {
  dark?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  dark: false,
})

const emit = defineEmits<{
  info: []
}>()

const LINE_MONTHS   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']
const LINE_SESSIONS = [42, 58, 50, 72, 65, 88, 94]
const LINE_SIGNUPS  = [28, 40, 35, 55, 48, 70, 80]

const chartStyle = ref<ChartStyle>('line')
const hovered    = ref<number | null>(null)
const donutHov   = ref<number | null>(null)

const W = 520, H = 160, PX = 8, PY = 8, LABEL_H = 20
const chartH = H - PY * 2 - LABEL_H
const allVals = [...LINE_SESSIONS, ...LINE_SIGNUPS]
const dataMin = Math.min(...allVals), dataMax = Math.max(...allVals), dataRange = dataMax - dataMin || 1

function toX(i: number) { return PX + (i / (LINE_MONTHS.length - 1)) * (W - PX * 2) }
function toY(v: number) { return PY + chartH - ((v - dataMin) / dataRange) * chartH }

function pathD(vals: number[]) {
  return vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ')
}
function areaD(vals: number[]) {
  return `${pathD(vals)} L ${toX(vals.length - 1).toFixed(1)} ${(PY + chartH).toFixed(1)} L ${PX} ${(PY + chartH).toFixed(1)} Z`
}

const gridStroke = computed(() => props.dark ? '#1f2937' : '#f3f4f6')
const labelFill  = computed(() => props.dark ? '#6b7280' : '#9ca3af')
const dotStroke  = computed(() => props.dark ? '#1f2937' : 'white')
const barMax     = Math.max(...LINE_SESSIONS, ...LINE_SIGNUPS)

// Donut for combined totals
function buildDonutSlices(
  segments: { label: string; pct: number; color: string }[],
  cx: number, cy: number, outerR: number, innerR: number,
) {
  let cumAngle = -Math.PI / 2
  return segments.map((seg) => {
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

const totalSessions = LINE_SESSIONS.reduce((a, b) => a + b, 0)
const totalSignups  = LINE_SIGNUPS.reduce((a, b) => a + b, 0)
const donutTotal    = totalSessions + totalSignups
const sessionsPct   = Math.round((totalSessions / donutTotal) * 100)
const donutSegs     = [
  { label: 'Sessions', pct: sessionsPct,           color: '#1258ff' },
  { label: 'Sign-ups', pct: 100 - sessionsPct,     color: '#7aaaff' },
]
const donutSlices    = buildDonutSlices(donutSegs, 80, 80, 70, 34)
const donutActive    = computed(() => donutHov.value !== null ? donutSegs[donutHov.value] : donutSegs[0])

const gridLines = [0, 33, 66, 100].map((pct) => {
  const v = dataMin + (pct / 100) * dataRange
  return { y: toY(v) }
})
</script>

<template>
  <div :class="cn('relative rounded-2xl border p-5', dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200')">
    <div class="absolute top-4 right-4 flex items-center gap-0.5">
      <WidgetKebabMenu :dark="dark" initial-style="line" @chart-style-change="chartStyle = $event" />
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

    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2.5">
        <div :class="cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', dark ? 'bg-brand-950' : 'bg-brand-50')">
          <!-- Bell icon -->
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="dark ? 'text-brand-400' : 'text-brand-600'">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </div>
        <p :class="cn('text-xs font-normal uppercase tracking-widest', dark ? 'text-gray-500' : 'text-gray-400')">
          Monthly Trends
        </p>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-0.5 rounded-full" style="background-color: #1258ff" />
          <span :class="cn('text-xs', dark ? 'text-gray-400' : 'text-gray-500')">Sessions</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-0.5 rounded-full" style="background-color: #7aaaff" />
          <span :class="cn('text-xs', dark ? 'text-gray-400' : 'text-gray-500')">Sign-ups</span>
        </div>
      </div>
    </div>

    <!-- Line chart -->
    <div v-if="chartStyle === 'line'" class="relative">
      <svg width="100%" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="overflow-visible">
        <line
          v-for="(gl, i) in gridLines"
          :key="i"
          :x1="PX"
          :y1="gl.y"
          :x2="W - PX"
          :y2="gl.y"
          :stroke="gridStroke"
          stroke-width="1"
        />
        <path :d="areaD(LINE_SIGNUPS)"  fill="#7aaaff" fill-opacity="0.08" />
        <path :d="areaD(LINE_SESSIONS)" fill="#1258ff" fill-opacity="0.08" />
        <path :d="pathD(LINE_SIGNUPS)"  fill="none" stroke="#7aaaff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path :d="pathD(LINE_SESSIONS)" fill="none" stroke="#1258ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <line
          v-if="hovered !== null"
          :x1="toX(hovered)"
          :y1="PY"
          :x2="toX(hovered)"
          :y2="PY + chartH"
          :stroke="dark ? '#374151' : '#e5e7eb'"
          stroke-width="1"
          stroke-dasharray="3 2"
        />
        <circle
          v-for="(v, i) in LINE_SESSIONS"
          :key="`s${i}`"
          :cx="toX(i)"
          :cy="toY(v)"
          :r="hovered === i ? 5 : 3.5"
          fill="#1258ff"
          :stroke="dotStroke"
          stroke-width="2"
          class="transition-all duration-100"
        />
        <circle
          v-for="(v, i) in LINE_SIGNUPS"
          :key="`u${i}`"
          :cx="toX(i)"
          :cy="toY(v)"
          :r="hovered === i ? 5 : 3.5"
          fill="#7aaaff"
          :stroke="dotStroke"
          stroke-width="2"
          class="transition-all duration-100"
        />
        <rect
          v-for="(_, i) in LINE_MONTHS"
          :key="`r${i}`"
          :x="toX(i) - (W / LINE_MONTHS.length) / 2"
          :y="PY"
          :width="W / LINE_MONTHS.length"
          :height="chartH"
          fill="transparent"
          class="cursor-crosshair"
          @mouseenter="hovered = i"
          @mouseleave="hovered = null"
        />
        <text
          v-for="(m, i) in LINE_MONTHS"
          :key="`l${i}`"
          :x="toX(i)"
          :y="H - 2"
          text-anchor="middle"
          :fill="hovered === i ? (dark ? '#e5e7eb' : '#374151') : labelFill"
          font-size="11"
          :font-weight="hovered === i ? '600' : '400'"
        >
          {{ m }}
        </text>
      </svg>
      <div
        v-if="hovered !== null"
        class="absolute bottom-6 pointer-events-none z-10 -translate-x-1/2"
        :style="{ left: `${(toX(hovered) / W) * 100}%` }"
      >
        <div :class="cn('px-2.5 py-1.5 rounded-lg shadow-md text-xs whitespace-nowrap', dark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white')">
          <p class="font-semibold mb-0.5">{{ LINE_MONTHS[hovered] }}</p>
          <p><span style="color: #7aaaff">●</span> Sessions: <span class="font-semibold">{{ LINE_SESSIONS[hovered] }}</span></p>
          <p><span style="color: #a5c4ff">●</span> Sign-ups: <span class="font-semibold">{{ LINE_SIGNUPS[hovered] }}</span></p>
        </div>
        <div :class="cn('mx-auto w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px]', dark ? 'border-t-gray-700' : 'border-t-gray-900')" />
      </div>
    </div>

    <!-- Bar chart -->
    <div v-else-if="chartStyle === 'bar'">
      <div class="flex items-end gap-2" style="height: 140px">
        <div
          v-for="(m, i) in LINE_MONTHS"
          :key="m"
          class="flex-1 flex flex-col items-center gap-1 h-full justify-end"
          @mouseenter="hovered = i"
          @mouseleave="hovered = null"
        >
          <div class="w-full flex gap-0.5 items-end" style="height: 90%">
            <div
              class="flex-1 rounded-t-sm transition-all duration-300"
              :style="{ height: `${(LINE_SESSIONS[i] / barMax) * 100}%`, backgroundColor: hovered === i ? '#0241e3' : '#1258ff' }"
            />
            <div
              class="flex-1 rounded-t-sm transition-all duration-300"
              :style="{ height: `${(LINE_SIGNUPS[i] / barMax) * 100}%`, backgroundColor: hovered === i ? '#5ba0ff' : '#7aaaff' }"
            />
          </div>
          <span :class="cn('text-[10px]', hovered === i ? (dark ? 'text-gray-200' : 'text-gray-700') : labelFill)">
            {{ m }}
          </span>
        </div>
      </div>
      <div
        v-if="hovered !== null"
        :class="cn('mt-2 px-2.5 py-1.5 rounded-lg text-xs inline-flex gap-3', dark ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700')"
      >
        <span class="font-semibold">{{ LINE_MONTHS[hovered] }}</span>
        <span><span style="color: #1258ff">●</span> {{ LINE_SESSIONS[hovered] }}</span>
        <span><span style="color: #7aaaff">●</span> {{ LINE_SIGNUPS[hovered] }}</span>
      </div>
    </div>

    <!-- Donut -->
    <div v-else-if="chartStyle === 'donut'" class="flex items-center gap-5">
      <svg width="160" height="160" viewBox="0 0 160 160" class="shrink-0">
        <path
          v-for="(s, i) in donutSlices"
          :key="i"
          :d="s.path"
          :fill="s.color"
          :stroke="dark ? '#1f2937' : 'white'"
          stroke-width="2"
          class="cursor-pointer transition-opacity duration-150"
          :style="{ opacity: donutHov === null || donutHov === i ? 1 : 0.3 }"
          @mouseenter="donutHov = i"
          @mouseleave="donutHov = null"
        />
        <text x="80" y="75" text-anchor="middle" :fill="dark ? '#9ca3af' : '#6b7280'" font-size="11" font-weight="600">
          {{ donutActive.label }}
        </text>
        <text x="80" y="95" text-anchor="middle" :fill="dark ? '#f9fafb' : '#111827'" font-size="22" font-weight="700">
          {{ donutActive.pct }}%
        </text>
      </svg>
      <div class="flex flex-col gap-3">
        <div
          v-for="(s, i) in donutSegs"
          :key="s.label"
          :class="cn('flex items-center gap-2 transition-opacity duration-150', donutHov !== null && donutHov !== i ? 'opacity-30' : '')"
          @mouseenter="donutHov = i"
          @mouseleave="donutHov = null"
        >
          <div class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: s.color }" />
          <span :class="cn('text-xs', dark ? 'text-gray-400' : 'text-gray-500')">{{ s.label }}</span>
          <span :class="cn('text-xs font-semibold ml-auto', dark ? 'text-white' : 'text-gray-900')">{{ s.pct }}%</span>
        </div>
      </div>
    </div>

    <div :class="cn('flex items-center gap-1 text-xs font-normal mt-3', dark ? 'text-green-400' : 'text-green-600')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
      <span>+12.9%</span>
      <span :class="cn('font-normal ml-0.5', dark ? 'text-gray-500' : 'text-gray-400')">vs last month</span>
    </div>
  </div>
</template>
