<script setup lang="ts">
import { cn } from './lib/utils'

export interface StepItem {
  label: string
  desc?: string
}

export type StepperVariant = 'horizontal' | 'vertical' | 'dots'

interface Props {
  steps: StepItem[]
  active: number
  variant?: StepperVariant
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'horizontal',
})

const emit = defineEmits<{
  change: [step: number]
}>()
</script>

<template>
  <!-- Dots -->
  <div v-if="variant === 'dots'" :class="cn('flex items-center', props.class)">
    <template v-for="(step, i) in steps" :key="i">
      <div
        v-if="i > 0"
        :class="cn('h-0.5 flex-1', i <= active ? 'bg-brand-600' : 'bg-gray-200')"
      />
      <button
        type="button"
        :title="step.label"
        :aria-label="step.label"
        :class="cn(
          'rounded-full transition-all duration-200 shrink-0',
          i === active || i < active ? 'w-3 h-3 bg-brand-600' : 'w-2 h-2 bg-gray-200',
        )"
        @click="emit('change', i)"
      />
    </template>
  </div>

  <!-- Vertical -->
  <div v-else-if="variant === 'vertical'" :class="cn('flex flex-col', props.class)">
    <div v-for="(step, i) in steps" :key="i" class="flex gap-3">
      <div class="flex flex-col items-center">
        <button
          type="button"
          :class="cn(
            'w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-normal transition-all duration-200 shrink-0',
            i < active || i === active
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'bg-white border-gray-200 text-gray-400',
          )"
          @click="emit('change', i)"
        >
          <svg v-if="i < active" width="12" height="10" viewBox="0 0 12 10" fill="none">
            <path d="M1 5l3.5 3.5L11 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-else>{{ i + 1 }}</span>
        </button>
        <div
          v-if="i < steps.length - 1"
          :class="cn('w-0.5 min-h-[2rem] flex-1 my-1', i < active ? 'bg-brand-600' : 'bg-gray-200')"
        />
      </div>
      <div :class="cn('pb-6', i === steps.length - 1 && 'pb-0')">
        <p :class="cn(
          'text-sm font-normal',
          i === active ? 'text-gray-900' : i < active ? 'text-gray-600' : 'text-gray-400',
        )">
          {{ step.label }}
        </p>
        <p v-if="step.desc" class="text-xs text-gray-400 mt-0.5">{{ step.desc }}</p>
      </div>
    </div>
  </div>

  <!-- Horizontal (default) -->
  <div v-else :class="cn('flex items-start', props.class)">
    <template v-for="(step, i) in steps" :key="i">
      <div class="flex flex-col items-center gap-1.5">
        <button
          type="button"
          :class="cn(
            'w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-normal transition-all duration-200',
            i < active || i === active
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'bg-white border-gray-200 text-gray-400',
          )"
          @click="emit('change', i)"
        >
          <svg v-if="i < active" width="12" height="10" viewBox="0 0 12 10" fill="none">
            <path d="M1 5l3.5 3.5L11 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-else>{{ i + 1 }}</span>
        </button>
        <div class="text-center">
          <p :class="cn(
            'text-xs font-normal whitespace-nowrap',
            i === active ? 'text-gray-900' : i < active ? 'text-gray-600' : 'text-gray-400',
          )">
            {{ step.label }}
          </p>
          <p v-if="step.desc" class="text-[11px] text-gray-400 mt-0.5">{{ step.desc }}</p>
        </div>
      </div>
      <div
        v-if="i < steps.length - 1"
        :class="cn('h-0.5 flex-1 mt-4 mx-2', i < active ? 'bg-brand-600' : 'bg-gray-200')"
      />
    </template>
  </div>
</template>
