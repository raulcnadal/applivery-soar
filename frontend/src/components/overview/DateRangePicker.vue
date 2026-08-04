<script setup lang="ts">
// 1:1 port of DateRangePickerDropdown (App.jsx ~839-970): a preset list on
// the left, a dual always-visible calendar on the right, and an
// Apply/Cancel footer. Replaces the plain <select> the migration originally
// shipped with.
import { computed, ref } from "vue";
import CalendarMonth from "./CalendarMonth.vue";
import { useUiStore } from "../../stores/ui";

const uiStore = useUiStore();

export interface DateRangeValue {
  label: string;
  from: Date;
  to: Date;
}

const props = defineProps<{
  value: DateRangeValue;
  primaryBlue: string;
}>();

const emit = defineEmits<{
  apply: [value: DateRangeValue];
  cancel: [];
}>();

const PRESETS: Array<{ label: string; getRange: (() => { from: Date; to: Date }) | null }> = [
  { label: "Today", getRange: () => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return { from: s, to: s }; } },
  { label: "Yesterday", getRange: () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return { from: s, to: s }; } },
  { label: "Last 7 Days", getRange: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 6); return { from, to }; } },
  { label: "Last 30 Days", getRange: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 29); return { from, to }; } },
  { label: "This Month", getRange: () => { const d = new Date(); return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date() }; } },
  { label: "Last Month", getRange: () => { const d = new Date(); return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1), to: new Date(d.getFullYear(), d.getMonth(), 0) }; } },
  { label: "Custom Range", getRange: null },
];

const pendingFrom = ref<Date | null>(props.value.from);
const pendingTo = ref<Date | null>(props.value.to);
const activeLabel = ref(props.value.label || "Last 30 Days");
const hoverDate = ref<Date | null>(null);
const isCustom = computed(() => activeLabel.value === "Custom Range");

function initialLeftYM(d: Date) {
  const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  return { year: y, month: m };
}
const leftYM = ref(initialLeftYM(props.value.from || new Date()));
const rightYM = computed(() => {
  const m = leftYM.value.month + 1;
  return m > 11 ? { year: leftYM.value.year + 1, month: 0 } : { year: leftYM.value.year, month: m };
});
function prevMonth() {
  leftYM.value = leftYM.value.month === 0 ? { year: leftYM.value.year - 1, month: 11 } : { ...leftYM.value, month: leftYM.value.month - 1 };
}
function nextMonth() {
  leftYM.value = leftYM.value.month === 11 ? { year: leftYM.value.year + 1, month: 0 } : { ...leftYM.value, month: leftYM.value.month + 1 };
}

function selectPreset(preset: (typeof PRESETS)[number]) {
  activeLabel.value = preset.label;
  if (preset.getRange) {
    const r = preset.getRange();
    pendingFrom.value = r.from;
    pendingTo.value = r.to;
    leftYM.value = initialLeftYM(r.from);
  }
}

function handleDayClick(d: Date) {
  if (activeLabel.value !== "Custom Range") {
    activeLabel.value = "Custom Range";
    pendingFrom.value = d;
    pendingTo.value = null;
    return;
  }
  if (!pendingFrom.value || pendingTo.value) {
    pendingFrom.value = d;
    pendingTo.value = null;
  } else if (d < pendingFrom.value) {
    pendingTo.value = pendingFrom.value;
    pendingFrom.value = d;
  } else {
    pendingTo.value = d;
  }
}

function fmt(d: Date | null): string {
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

function apply() {
  if (pendingFrom.value) {
    emit("apply", { label: activeLabel.value, from: pendingFrom.value, to: pendingTo.value || pendingFrom.value });
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
</script>

<template>
  <div class="absolute right-0 top-full mt-2 z-[300] rounded-2xl shadow-2xl border overflow-hidden flex bg-white dark:bg-gray-800" :style="{ borderColor: uiStore.activeTheme.border }">
    <!-- Presets -->
    <div class="flex flex-col py-4 border-r" :style="{ borderColor: uiStore.activeTheme.border, minWidth: '160px' }">
      <button
        v-for="p in PRESETS"
        :key="p.label"
        type="button"
        class="px-5 py-2.5 text-left text-sm transition-all hover:opacity-80"
        :style="{
          color: activeLabel === p.label ? primaryBlue : 'var(--foreground)',
          fontWeight: activeLabel === p.label ? 600 : 400,
          backgroundColor: activeLabel === p.label ? primaryBlue + '10' : 'transparent',
          borderLeft: activeLabel === p.label ? `3px solid ${primaryBlue}` : '3px solid transparent',
        }"
        @click="selectPreset(p)"
      >
        {{ p.label }}
      </button>
    </div>

    <!-- Dual calendar -->
    <div class="flex flex-col p-5 gap-4">
      <div class="flex gap-6 items-start">
        <div>
          <div class="flex items-center justify-between mb-3 gap-4">
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 text-lg font-light transition-opacity text-gray-900 dark:text-white" @click="prevMonth">‹</button>
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ MONTHS[leftYM.month] }} {{ leftYM.year }}</span>
            <div class="w-7" />
          </div>
          <CalendarMonth
            :year="leftYM.year"
            :month="leftYM.month"
            :from="pendingFrom"
            :to="pendingTo"
            :hover-date="pendingTo ? null : hoverDate"
            :primary-blue="primaryBlue"
            :is-custom="isCustom"
            @day-click="handleDayClick"
            @day-hover="hoverDate = $event"
          />
        </div>
        <div>
          <div class="flex items-center justify-between mb-3 gap-4">
            <div class="w-7" />
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ MONTHS[rightYM.month] }} {{ rightYM.year }}</span>
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 text-lg font-light transition-opacity text-gray-900 dark:text-white" @click="nextMonth">›</button>
          </div>
          <CalendarMonth
            :year="rightYM.year"
            :month="rightYM.month"
            :from="pendingFrom"
            :to="pendingTo"
            :hover-date="pendingTo ? null : hoverDate"
            :primary-blue="primaryBlue"
            :is-custom="isCustom"
            @day-click="handleDayClick"
            @day-hover="hoverDate = $event"
          />
        </div>
      </div>

      <div class="flex items-center justify-between border-t pt-4 gap-6" :style="{ borderColor: uiStore.activeTheme.border }">
        <span class="text-sm tabular-nums" :style="{ color: uiStore.activeTheme.textMuted }">{{ fmt(pendingFrom) }}<template v-if="pendingFrom"> – </template>{{ fmt(pendingTo) }}</span>
        <div class="flex gap-2 shrink-0">
          <button type="button" class="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-70" :style="{ color: uiStore.activeTheme.textMuted, borderColor: uiStore.activeTheme.border }" @click="emit('cancel')">Cancel</button>
          <button
            type="button"
            class="px-6 py-2 rounded-lg text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            :style="{ backgroundColor: primaryBlue }"
            :disabled="!pendingFrom"
            @click="apply"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
