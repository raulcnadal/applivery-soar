<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

const triggerRef = ref<HTMLDivElement | null>(null)
const tooltipRef = ref<HTMLDivElement | null>(null)
const visible    = ref(false)
const position   = ref<{ top: number; left: number } | null>(null)

function show() {
  if (triggerRef.value) {
    const rect = triggerRef.value.getBoundingClientRect()
    position.value = { top: rect.top - 8, left: rect.left + rect.width / 2 }
    visible.value  = true
  }
}

function hide() {
  visible.value = false
}

watch(
  [visible, position],
  async ([isVisible]) => {
    if (isVisible && tooltipRef.value && position.value) {
      await nextTick()
      const el   = tooltipRef.value
      const rect = el.getBoundingClientRect()
      const vw   = window.innerWidth
      if (rect.right > vw - 8) {
        position.value = { ...position.value, left: position.value.left - (rect.right - vw + 16) }
      }
      if (rect.left < 8) {
        position.value = { ...position.value, left: position.value.left + (16 - rect.left) }
      }
    }
  },
)
</script>

<template>
  <div ref="triggerRef" class="inline-flex cursor-help" @mouseenter="show" @mouseleave="hide">
    <slot />
  </div>

  <Teleport to="body">
    <div
      v-if="visible && position"
      ref="tooltipRef"
      class="fixed z-[100] pointer-events-none"
      :style="{
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translate(-50%, -100%)',
      }"
    >
      <div class="px-3 py-2 max-w-[min(240px,calc(100vw-32px))] bg-gray-900 text-white text-xs font-light leading-normal rounded-lg shadow-lg">
        <slot name="content" />
      </div>
      <div class="mx-auto w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900" />
    </div>
  </Teleport>
</template>
