<script setup lang="ts">
// Phase 0 placeholder proving the BlueSky Vue component library and Pinia
// are wired correctly end-to-end. Real widget catalog / grid-layout-plus /
// globe.gl / vue-echarts wiring lands in Phase 7 (see migration-plan.md §8).
import { Card, PageHeader, StatusPill } from "@applivery/bluesky-vue";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Overview" description="Phase 0 scaffold — dashboard widgets land in Phase 7" />
    <div class="grid grid-cols-3 gap-4">
      <Card title="Scaffolding status">
        <div class="space-y-3 text-sm text-slate-600">
          <p class="flex items-center gap-2">Vue 3 + Pinia + Vue Router <StatusPill label="wired" color="green" /></p>
          <p class="flex items-center gap-2">@applivery/bluesky-vue <StatusPill label="wired" color="green" /></p>
          <p class="flex items-center gap-2">Theme mode <StatusPill :label="ui.themeMode" color="brand" /></p>
        </div>
      </Card>
    </div>
  </div>
</template>
