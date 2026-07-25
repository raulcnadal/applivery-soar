<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type AvatarStatus = 'online' | 'away' | 'busy' | 'offline'

interface Props {
  src?: string
  name?: string
  size?: AvatarSize
  status?: AvatarStatus
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
})

const sizeMap: Record<AvatarSize, { container: string; text: string }> = {
  xs: { container: 'w-6 h-6',   text: 'text-[10px]' },
  sm: { container: 'w-8 h-8',   text: 'text-xs'     },
  md: { container: 'w-10 h-10', text: 'text-sm'      },
  lg: { container: 'w-12 h-12', text: 'text-base'    },
  xl: { container: 'w-16 h-16', text: 'text-xl'      },
}

const statusColorMap: Record<AvatarStatus, string> = {
  online:  'bg-green-500',
  away:    'bg-yellow-400',
  busy:    'bg-red-500',
  offline: 'bg-gray-300',
}

function getInitials(name?: string): string {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

const sizeClasses = computed(() => sizeMap[props.size])
const initials = computed(() => getInitials(props.name))
const statusClass = computed(() => props.status ? statusColorMap[props.status] : '')
</script>

<template>
  <div :class="cn('relative shrink-0', props.class)">
    <div v-if="src" :class="cn('rounded-full overflow-hidden bg-gray-100', sizeClasses.container)">
      <img :src="src" :alt="name ?? 'Avatar'" class="w-full h-full object-cover" />
    </div>
    <div
      v-else
      :class="cn(
        'rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-semibold select-none',
        sizeClasses.container,
        sizeClasses.text,
      )"
    >
      {{ initials }}
    </div>
    <span
      v-if="status"
      :class="cn('absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white', statusClass)"
    />
  </div>
</template>
