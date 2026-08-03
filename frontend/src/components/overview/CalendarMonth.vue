<script setup lang="ts">
// 1:1 port of CalendarMonth (App.jsx ~762-823) — a single month grid used
// twice (side by side) by DateRangePicker.
const props = defineProps<{
  year: number;
  month: number; // 0-indexed
  from: Date | null;
  to: Date | null;
  hoverDate: Date | null;
  primaryBlue: string;
  isCustom: boolean;
}>();

const emit = defineEmits<{
  dayClick: [d: Date];
  dayHover: [d: Date];
}>();

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.toDateString() === b.toDateString();
}

function buildCells(): Array<{ d: Date; outside: boolean }> {
  const { year, month } = props;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells: Array<{ d: Date; outside: boolean }> = [];
  for (let i = 0; i < firstDay; i++) cells.push({ d: new Date(year, month - 1, prevDays - firstDay + i + 1), outside: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d: new Date(year, month, d), outside: false });
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) cells.push({ d: new Date(year, month + 1, d), outside: true });
  return cells;
}

function effectiveTo(): Date | null {
  return props.isCustom && !props.to && props.hoverDate ? props.hoverDate : props.to;
}

function inRange(d: Date): boolean {
  const eTo = effectiveTo();
  if (!props.from || !eTo || sameDay(props.from, eTo)) return false;
  const lo = props.from <= eTo ? props.from : eTo;
  const hi = props.from <= eTo ? eTo : props.from;
  return d > lo && d < hi;
}
function isStart(d: Date): boolean {
  return sameDay(d, props.from);
}
function isEnd(d: Date): boolean {
  const eTo = effectiveTo();
  return !!eTo && sameDay(d, eTo) && !sameDay(props.from, eTo);
}
function isSingle(d: Date): boolean {
  return sameDay(d, props.from) && sameDay(props.from, effectiveTo());
}
</script>

<template>
  <div style="min-width: 260px">
    <div class="grid grid-cols-7 mb-1">
      <div v-for="d in DAYS" :key="d" class="text-center py-1 text-xs font-semibold text-gray-400">{{ d }}</div>
    </div>
    <div class="grid grid-cols-7">
      <div
        v-for="(cell, i) in buildCells()"
        :key="i"
        class="relative flex items-center justify-center select-none"
        style="height: 36px"
        :style="{ cursor: cell.outside ? 'default' : 'pointer' }"
        @click="!cell.outside && emit('dayClick', cell.d)"
        @mouseenter="isCustom && emit('dayHover', cell.d)"
      >
        <div v-if="inRange(cell.d) && !cell.outside" class="absolute inset-0" :style="{ backgroundColor: primaryBlue + '20' }" />
        <div v-if="isStart(cell.d) && !isSingle(cell.d) && !cell.outside" class="absolute top-[3px] bottom-[3px] right-0 left-1/2" :style="{ backgroundColor: primaryBlue + '20' }" />
        <div v-if="isEnd(cell.d) && !cell.outside" class="absolute top-[3px] bottom-[3px] left-0 right-1/2" :style="{ backgroundColor: primaryBlue + '20' }" />
        <div
          class="relative z-[1] flex items-center justify-center rounded-full text-sm transition-colors"
          :style="{
            width: '34px',
            height: '34px',
            backgroundColor: (isStart(cell.d) || isEnd(cell.d) || isSingle(cell.d)) && !cell.outside ? primaryBlue : 'transparent',
            color: cell.outside ? '#6B728055' : isStart(cell.d) || isEnd(cell.d) || isSingle(cell.d) ? '#fff' : 'var(--foreground)',
            fontWeight: (isStart(cell.d) || isEnd(cell.d) || isSingle(cell.d)) && !cell.outside ? 700 : 400,
            opacity: cell.outside ? 0.35 : 1,
          }"
        >
          {{ cell.d.getDate() }}
        </div>
      </div>
    </div>
  </div>
</template>
