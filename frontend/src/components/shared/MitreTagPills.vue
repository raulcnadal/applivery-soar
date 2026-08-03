<script setup lang="ts">
// Small read-only pills for a list of MITRE technique ids — degrades
// gracefully (shows the raw id) if the catalog hasn't loaded yet or the id
// is unrecognized. Port of MitreTagPills (shared/MitreCatalog.jsx:70-89).
import type { MitreTechniqueDef } from "../../lib/mitreCatalog";

const props = withDefaults(
  defineProps<{
    ids: string[];
    techniqueById: Record<string, MitreTechniqueDef>;
    tacticColor: Record<string, string>;
    size?: "sm" | "md";
  }>(),
  { size: "sm" },
);

function colorFor(id: string): string {
  const tech = props.techniqueById[id];
  return tech ? props.tacticColor[tech.tactic] || "#64748B" : "#94A3B8";
}
function titleFor(id: string): string | undefined {
  const tech = props.techniqueById[id];
  return tech ? `${tech.name} (${tech.tactic.replace(/-/g, " ")})` : undefined;
}
</script>

<template>
  <div v-if="ids?.length" class="flex flex-wrap gap-1">
    <span
      v-for="id in ids"
      :key="id"
      :title="titleFor(id)"
      class="inline-flex items-center rounded-full font-semibold"
      :class="size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'"
      :style="{ backgroundColor: `${colorFor(id)}15`, color: colorFor(id) }"
    >
      {{ id }}
    </span>
  </div>
</template>
