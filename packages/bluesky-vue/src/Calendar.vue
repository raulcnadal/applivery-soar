<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from './lib/utils'

const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const CAL_DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']

interface Props {
  rangeStart?: Date | null
  rangeEnd?: Date | null
  dark?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  rangeStart: null,
  rangeEnd: null,
  dark: false,
})

const emit = defineEmits<{
  rangeChange: [start: Date | null, end: Date | null]
}>()

function calDaysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function calFirstDay(y: number, m: number)    { return new Date(y, m, 1).getDay() }
function calSameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function calInRange(d: Date, s: Date | null, e: Date | null) {
  if (!s || !e) return false
  return d > s && d < e
}

const now = new Date()
const viewYear  = ref(now.getFullYear())
const viewMonth = ref(now.getMonth())
const internalStart = ref<Date | null>(null)
const internalEnd   = ref<Date | null>(null)
const hoverDate = ref<Date | null>(null)

const rangeStart = computed(() => props.rangeStart !== undefined ? props.rangeStart : internalStart.value)
const rangeEnd   = computed(() => props.rangeEnd   !== undefined ? props.rangeEnd   : internalEnd.value)

const m2 = computed(() => viewMonth.value === 11 ? 0  : viewMonth.value + 1)
const y2 = computed(() => viewMonth.value === 11 ? viewYear.value + 1 : viewYear.value)

function prevMonth() {
  if (viewMonth.value === 0) { viewYear.value -= 1; viewMonth.value = 11 }
  else viewMonth.value -= 1
}
function nextMonth() {
  if (viewMonth.value === 11) { viewYear.value += 1; viewMonth.value = 0 }
  else viewMonth.value += 1
}

function handleClick(date: Date) {
  if (!rangeStart.value || (rangeStart.value && rangeEnd.value)) {
    internalStart.value = date
    internalEnd.value   = null
    emit('rangeChange', date, null)
  } else {
    if (date <= rangeStart.value) {
      internalStart.value = date
      internalEnd.value   = null
      emit('rangeChange', date, null)
    } else {
      internalEnd.value = date
      emit('rangeChange', rangeStart.value, date)
    }
  }
}

function handleHover(date: Date) {
  if (rangeStart.value && !rangeEnd.value) hoverDate.value = date
}

const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const rangeLabel = computed(() =>
  rangeStart.value
    ? `${fmt(rangeStart.value)} → ${rangeEnd.value ? fmt(rangeEnd.value) : 'Select end date'}`
    : 'Click a day to start selecting',
)

interface DayCell {
  date: Date
  day: number
  isStart: boolean
  isEnd: boolean
  inRange: boolean
  isToday: boolean
}

function buildMonth(year: number, month: number): DayCell[] {
  const days        = calDaysInMonth(year, month)
  const effectiveEnd = rangeEnd.value ?? hoverDate.value
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(year, month, i + 1)
    return {
      date,
      day: i + 1,
      isStart: calSameDay(date, rangeStart.value),
      isEnd: calSameDay(date, effectiveEnd),
      inRange: calInRange(date, rangeStart.value, effectiveEnd),
      isToday: calSameDay(date, new Date()),
    }
  })
}

function firstDay(year: number, month: number) { return calFirstDay(year, month) }
</script>

<template>
  <div :class="cn('rounded-2xl border overflow-hidden w-full max-w-xl', dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200')">
    <!-- Header with month navigation -->
    <div :class="cn('flex items-center gap-3 px-4 py-3 border-b', dark ? 'border-gray-800' : 'border-gray-100')">
      <button
        :class="cn('p-1.5 rounded-lg transition-colors', dark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100')"
        @click="prevMonth"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span :class="cn('flex-1 text-xs font-normal text-center', dark ? 'text-gray-400' : 'text-gray-500')">
        {{ CAL_MONTHS[viewMonth] }} {{ viewYear }} — {{ CAL_MONTHS[m2] }} {{ y2 }}
      </span>
      <button
        :class="cn('p-1.5 rounded-lg transition-colors', dark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100')"
        @click="nextMonth"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>

    <div class="flex flex-col sm:flex-row">
      <!-- Month 1 -->
      <div class="p-4 flex-1">
        <div class="min-w-[210px]">
          <div class="grid grid-cols-7">
            <div
              v-for="d in CAL_DAYS"
              :key="d"
              :class="cn('text-center text-[11px] font-normal py-1', dark ? 'text-gray-500' : 'text-gray-400')"
            >
              {{ d }}
            </div>
            <div v-for="i in firstDay(viewYear, viewMonth)" :key="`e1${i}`" class="h-9" />
            <div
              v-for="cell in buildMonth(viewYear, viewMonth)"
              :key="cell.day"
              :class="cn(
                'h-9 flex items-center justify-center cursor-pointer',
                cell.inRange && !cell.isStart && !cell.isEnd && (dark ? 'bg-brand-950' : 'bg-brand-50'),
              )"
              @click="handleClick(cell.date)"
              @mouseenter="handleHover(cell.date)"
              @mouseleave="hoverDate = null"
            >
              <span :class="cn(
                'w-8 h-8 flex items-center justify-center rounded-full text-sm font-normal transition-colors select-none',
                (cell.isStart || cell.isEnd) && 'bg-brand-600 text-white',
                !cell.isStart && !cell.isEnd && cell.isToday && (dark ? 'text-brand-400 font-semibold' : 'text-brand-600 font-semibold'),
                !cell.isStart && !cell.isEnd && !cell.isToday && cell.inRange && (dark ? 'text-brand-200' : 'text-brand-700'),
                !cell.isStart && !cell.isEnd && !cell.isToday && !cell.inRange && (dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'),
              )">
                {{ cell.day }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div :class="cn('border-t sm:border-t-0 sm:border-l', dark ? 'border-gray-800' : 'border-gray-100')" />

      <!-- Month 2 -->
      <div class="p-4 flex-1">
        <div class="min-w-[210px]">
          <div class="grid grid-cols-7">
            <div
              v-for="d in CAL_DAYS"
              :key="d"
              :class="cn('text-center text-[11px] font-normal py-1', dark ? 'text-gray-500' : 'text-gray-400')"
            >
              {{ d }}
            </div>
            <div v-for="i in firstDay(y2, m2)" :key="`e2${i}`" class="h-9" />
            <div
              v-for="cell in buildMonth(y2, m2)"
              :key="cell.day"
              :class="cn(
                'h-9 flex items-center justify-center cursor-pointer',
                cell.inRange && !cell.isStart && !cell.isEnd && (dark ? 'bg-brand-950' : 'bg-brand-50'),
              )"
              @click="handleClick(cell.date)"
              @mouseenter="handleHover(cell.date)"
              @mouseleave="hoverDate = null"
            >
              <span :class="cn(
                'w-8 h-8 flex items-center justify-center rounded-full text-sm font-normal transition-colors select-none',
                (cell.isStart || cell.isEnd) && 'bg-brand-600 text-white',
                !cell.isStart && !cell.isEnd && cell.isToday && (dark ? 'text-brand-400 font-semibold' : 'text-brand-600 font-semibold'),
                !cell.isStart && !cell.isEnd && !cell.isToday && cell.inRange && (dark ? 'text-brand-200' : 'text-brand-700'),
                !cell.isStart && !cell.isEnd && !cell.isToday && !cell.inRange && (dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'),
              )">
                {{ cell.day }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Range label footer -->
    <div :class="cn('px-4 py-2.5 border-t text-xs', dark ? 'border-gray-800 text-gray-400' : 'border-gray-100 text-gray-500')">
      {{ rangeLabel }}
    </div>
  </div>
</template>
