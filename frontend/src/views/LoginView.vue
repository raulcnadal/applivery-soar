<script setup lang="ts">
// Phase 0 placeholder — real credentials → mfa → workspace-picker state
// machine (ARCHITECTURE.md §1.3) is built in Phase 1 alongside
// /api/auth/login on the backend.
import { Button, Card, Input } from "@applivery/bluesky-vue";
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[var(--background)]">
    <Card class="w-full max-w-sm p-8 space-y-4">
      <h1 class="text-lg font-semibold text-brand-900">Applivery SOAR</h1>
      <p class="text-sm text-slate-500">Sign-in flow ships in Phase 1.</p>
      <Input placeholder="Email" type="email" disabled />
      <Input placeholder="Password" type="password" disabled />
      <Button class="w-full" disabled>Sign in</Button>
    </Card>
  </div>
</template>
