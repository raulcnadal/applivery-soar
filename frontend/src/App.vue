<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppShell from "./layouts/AppShell.vue";

// The login screen renders standalone (no sidebar); every other route gets
// the AppShell nav wrapper.
const route = useRoute();
const isLogin = computed(() => route.name === "login");
</script>

<template>
  <AppShell v-if="!isLogin" />
  <RouterView v-else />
</template>
