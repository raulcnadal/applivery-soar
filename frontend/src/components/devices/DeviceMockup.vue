<script setup lang="ts">
// Port of DeviceMockup + OS_BADGE (DeviceFleetTable.jsx:14-88) — a device
// avatar with a small platform-logo badge in the bottom-left corner.
defineProps<{ platform: string; size?: number }>();

const OS_BADGE_BG: Record<string, string> = {
  apple: "#1D1D1F",
  macos: "#1D1D1F",
  android: "#3DDC84",
  windows: "#0078D4",
  other: "#6B7280",
};

function bgFor(platform: string) {
  return OS_BADGE_BG[platform] ?? OS_BADGE_BG.other;
}
</script>

<template>
  <div class="relative shrink-0" :style="{ width: `${size ?? 40}px`, height: `${size ?? 40}px` }">
    <div class="w-full h-full rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-700">
      <svg :width="(size ?? 40) * 0.5" :height="(size ?? 40) * 0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="text-gray-400">
        <rect x="6" y="2" width="12" height="20" rx="2" stroke-width="1.6" />
        <line x1="10" y1="18" x2="14" y2="18" stroke-width="1.6" stroke-linecap="round" />
      </svg>
    </div>
    <div class="absolute rounded-full flex items-center justify-center bg-white dark:bg-gray-800 p-0.5" style="bottom: -2px; left: -2px; width: 20px; height: 20px">
      <div class="w-full h-full rounded-full flex items-center justify-center" :style="{ backgroundColor: bgFor(platform) }">
        <svg v-if="platform === 'apple' || platform === 'macos'" viewBox="0 0 14 14" width="9" height="9" fill="white">
          <path d="M11.05 7.44c-.02-1.88 1.54-2.79 1.61-2.83-.88-1.28-2.24-1.46-2.72-1.48-1.16-.12-2.26.68-2.85.68-.59 0-1.51-.66-2.48-.64-1.27.02-2.44.74-3.09 1.87C.05 7.04.92 10.5 2.38 12.37c.72.99 1.57 2.1 2.69 2.06 1.08-.04 1.49-.7 2.79-.7 1.3 0 1.67.7 2.81.68 1.16-.02 1.89-1.01 2.6-2 .82-1.14 1.16-2.26 1.18-2.32-.03-.01-2.38-.91-2.4-2.65zM9.07 2.13C9.65 1.43 10.04.48 9.93-.5 9.05-.46 7.98.09 7.37.79c-.55.62-.99 1.59-.87 2.53.98.07 1.97-.47 2.57-1.19z" />
        </svg>
        <svg v-else-if="platform === 'android'" viewBox="5 4 14 16" width="11" height="11">
          <path fill="white" d="M6 14C6 10 8.69 8 12 8s6 2 6 6V18H6v-4z" />
          <path fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" d="M8.5 8.5L7 6" />
          <path fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" d="M15.5 8.5L17 6" />
          <circle cx="9.5" cy="13" r="1.2" fill="#3DDC84" />
          <circle cx="14.5" cy="13" r="1.2" fill="#3DDC84" />
        </svg>
        <svg v-else-if="platform === 'windows'" viewBox="0 0 24 24" width="9" height="9" fill="white">
          <path d="M0 3.449L9.75 2.1v9.451H0V3.449zm10.949-1.51L24 0v11.4H10.949V1.939zM0 12.6h9.75v9.451L0 20.699V12.6zm10.949.6H24V24l-13.051-1.699V13.2z" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="10" height="10" fill="white">
          <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z" />
        </svg>
      </div>
    </div>
  </div>
</template>
