<script setup lang="ts">
// Port of SlaBadge (CasesView.jsx:98-113) — red "Resolve overdue"/amber "Ack
// overdue" if breached, otherwise a plain gray "Due Xh/Xd" countdown. Used
// on both the case list row and the detail drawer header.
import type { CaseSlaStatus } from "../../stores/cases";

const DANGER = "#EF4444";
const WARNING = "#F59E0B";
const MUTED = "#94A3B8";

defineProps<{ slaStatus?: CaseSlaStatus | null }>();

function slaCountdown(dueIso?: string | null): { overdue: boolean; text: string } | null {
  if (!dueIso) return null;
  const diffMs = new Date(dueIso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60000);
  let text: string;
  if (mins < 60) text = `${Math.max(mins, 1)}m`;
  else if (mins < 1440) text = `${Math.floor(mins / 60)}h`;
  else text = `${Math.floor(mins / 1440)}d`;
  return { overdue: diffMs < 0, text };
}
</script>

<template>
  <span
    v-if="slaStatus?.resolveBreached"
    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0"
    :style="{ backgroundColor: `${DANGER}15`, color: DANGER }"
  >
    Resolve overdue{{ slaCountdown(slaStatus.resolveDueAt) ? ` ${slaCountdown(slaStatus.resolveDueAt)!.text}` : "" }}
  </span>
  <span
    v-else-if="slaStatus?.ackBreached"
    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0"
    :style="{ backgroundColor: `${WARNING}15`, color: WARNING }"
  >
    Ack overdue{{ slaCountdown(slaStatus.ackDueAt) ? ` ${slaCountdown(slaStatus.ackDueAt)!.text}` : "" }}
  </span>
  <span
    v-else-if="slaStatus && (slaStatus.ackDueAt || slaStatus.resolveDueAt) && slaCountdown(slaStatus.ackDueAt || slaStatus.resolveDueAt)"
    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0"
    :style="{ backgroundColor: `${MUTED}15`, color: MUTED }"
  >
    Due {{ slaCountdown(slaStatus.ackDueAt || slaStatus.resolveDueAt)!.text }}
  </span>
</template>
