<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { cn } from './lib/utils'

export interface CommandItem {
  id: string
  label: string
  description?: string
  group?: string
  onSelect: () => void
}

interface Props {
  open: boolean
  items: CommandItem[]
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Search…',
})

const emit = defineEmits<{
  close: []
}>()

const query   = ref('')
const activeId = ref<string | null>(null)

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      window.addEventListener('keydown', onKeyDown)
    } else {
      window.removeEventListener('keydown', onKeyDown)
      query.value   = ''
      activeId.value = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})

const filtered = computed(() => {
  if (!query.value.trim()) return props.items
  const q = query.value.toLowerCase()
  return props.items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q),
  )
})

const grouped = computed(() => {
  const map = new Map<string, CommandItem[]>()
  for (const item of filtered.value) {
    const key = item.group ?? ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return map
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50" @click="emit('close')" />

      <!-- Panel -->
      <div class="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
        <!-- Search row -->
        <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <!-- Magnifer SVG -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 shrink-0">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            v-model="query"
            autofocus
            :placeholder="placeholder"
            class="flex-1 text-sm bg-transparent outline-none text-gray-900 placeholder:text-gray-400"
          />
          <kbd class="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 font-mono">
            ESC
          </kbd>
        </div>

        <!-- Results -->
        <div class="py-2 max-h-80 overflow-y-auto">
          <p v-if="grouped.size === 0" class="px-4 py-6 text-sm text-center text-gray-400">
            No results found
          </p>
          <template v-else>
            <div v-for="[group, groupItems] in grouped" :key="group">
              <p
                v-if="group"
                class="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400"
              >
                {{ group }}
              </p>
              <button
                v-for="item in groupItems"
                :key="item.id"
                :class="cn(
                  'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg mx-1 transition-colors text-left',
                  activeId === item.id ? 'bg-brand-600' : 'hover:bg-gray-50',
                )"
                style="width: calc(100% - 8px)"
                @mouseenter="activeId = item.id"
                @mouseleave="activeId = null"
                @click="() => { item.onSelect(); emit('close') }"
              >
                <div
                  :class="cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                    activeId === item.id ? 'bg-white/20' : 'bg-gray-100',
                  )"
                >
                  <slot :name="`icon-${item.id}`" />
                </div>
                <div class="flex-1 min-w-0">
                  <p :class="cn('text-sm font-medium', activeId === item.id ? 'text-white' : 'text-gray-700')">
                    {{ item.label }}
                  </p>
                  <p
                    v-if="item.description"
                    :class="cn('text-xs truncate', activeId === item.id ? 'text-white/70' : 'text-gray-400')"
                  >
                    {{ item.description }}
                  </p>
                </div>
                <kbd
                  v-if="activeId === item.id"
                  class="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-white/20 text-white"
                >
                  ↵
                </kbd>
              </button>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="px-4 py-2 border-t border-gray-100 flex items-center gap-3 text-[10px] text-gray-400">
          <span><kbd class="font-mono">↑↓</kbd> navigate</span>
          <span><kbd class="font-mono">↵</kbd> select</span>
          <span><kbd class="font-mono">ESC</kbd> close</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
