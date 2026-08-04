<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppShell from "./layouts/AppShell.vue";

// Login and the RBAC access-denied screen both render standalone (no
// sidebar/nav — a denied account must not see any nav chrome hinting at
// what exists behind it); every other route gets the AppShell nav wrapper.
const route = useRoute();
const isStandalone = computed(() => route.name === "login" || route.name === "access-denied");
</script>

<template>
  <AppShell v-if="!isStandalone" />
  <RouterView v-else />
</template>
