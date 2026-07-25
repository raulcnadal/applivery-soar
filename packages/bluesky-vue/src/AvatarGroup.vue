<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './lib/utils'
import Avatar from './Avatar.vue'
import type { AvatarSize } from './Avatar.vue'

interface AvatarItem {
  src?: string
  name?: string
}

interface Props {
  avatars: AvatarItem[]
  max?: number
  size?: AvatarSize
}

const props = withDefaults(defineProps<Props>(), {
  max: 4,
  size: 'md',
})

const sizeMap: Record<AvatarSize, { container: string; text: string }> = {
  xs: { container: 'w-6 h-6',   text: 'text-[10px]' },
  sm: { container: 'w-8 h-8',   text: 'text-xs'     },
  md: { container: 'w-10 h-10', text: 'text-sm'      },
  lg: { container: 'w-12 h-12', text: 'text-base'    },
  xl: { container: 'w-16 h-16', text: 'text-xl'      },
}

const visible = computed(() => props.avatars.slice(0, props.max))
const overflow = computed(() => props.avatars.length - props.max)
const sizeClasses = computed(() => sizeMap[props.size])
</script>

<template>
  <div class="flex -space-x-2">
    <div
      v-for="(avatar, index) in visible"
      :key="index"
      class="ring-2 ring-white rounded-full shrink-0"
    >
      <Avatar :src="avatar.src" :name="avatar.name" :size="size" />
    </div>
    <div
      v-if="overflow > 0"
      :class="cn(
        'rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center text-gray-500 shrink-0',
        sizeClasses.container,
        sizeClasses.text,
      )"
    >
      +{{ overflow }}
    </div>
  </div>
</template>
