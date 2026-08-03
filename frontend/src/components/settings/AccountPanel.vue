<script setup lang="ts">
// "Account" tab (docs/settings.md#account) — read-only profile, workspace
// switcher, sign out. None of this existed anywhere in the app before
// (no sign-out control existed at all) — built from the auth store's
// already-plumbed fields plus the newly-added switchWorkspace().
import { Avatar, Button, Input } from "@applivery/bluesky-vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const isSwitching = ref(false);

const orgOptions = computed(() =>
  auth.organizations.map((o) => ({ value: o.slug || o._id || o.id || "", label: o.name || o.slug || "Unnamed organization" })),
);

async function onSwitch(slug: string) {
  if (!slug || slug === auth.orgSlug) return;
  isSwitching.value = true;
  try {
    await auth.switchWorkspace(slug);
    // Full reload so every store re-fetches clean against the new
    // workspace — same reasoning as AppShell.vue's onCloned after a config
    // clone.
    window.location.reload();
  } finally {
    isSwitching.value = false;
  }
}

function signOut() {
  auth.clearSession();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <div class="flex items-center gap-4">
      <Avatar :src="auth.avatarUrl ?? undefined" :name="auth.fullName ?? auth.email ?? ''" size="lg" />
      <div>
        <p class="text-sm font-medium text-gray-900 dark:text-white">{{ auth.fullName || auth.email }}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ auth.email }}</p>
      </div>
    </div>

    <div v-if="auth.organizations.length > 1">
      <Input
        :model-value="auth.orgSlug ?? ''"
        type="select"
        :options="orgOptions"
        label="Workspace"
        :disabled="isSwitching"
        @update:model-value="onSwitch($event as string)"
      />
    </div>

    <div class="pt-2 border-t border-gray-100 dark:border-gray-800">
      <Button variant="ghost" @click="signOut">Sign out</Button>
    </div>
  </div>
</template>
