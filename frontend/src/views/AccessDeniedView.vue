<script setup lang="ts">
// 1:1 port of App.jsx's AccessDeniedScreen (~line 6752) — shown when
// POST /api/auth/resolve-access comes back allowed:false: no Applivery
// Collaborator record found, or (more commonly) a real record but no SOAR
// Role mapped to their tag yet. "Never a silent read-only fallback, per
// the explicit RBAC design: unmapped collaborators get nothing until a
// Super Admin maps their tag to a Role under Settings > Roles" (original's
// own comment, ~line 6750).
//
// This view — and the router guard in router/index.ts that redirects here
// whenever auth.access is resolved and !allowed — were the missing half of
// the RBAC port: resolveAccess() itself, and the per-area hasFeatureAccess()
// checks gating individual nav tabs/buttons, were already faithfully
// ported, but nothing ever blocked navigation on a denied result. The
// Overview route in particular has no `area` in AppShell.vue's NAV_TABS
// (it's the app's landing page, meant to always be reachable once inside),
// so a signed-in-but-unmapped account could reach it, and everything else
// that isn't behind its own hasFeatureAccess() check, with zero warning —
// the "lite view" a denied user should never see at all.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ICONS } from "../lib/solarIcons";
import { useAuthStore } from "../stores/auth";
import { useUiStore } from "../stores/ui";

const auth = useAuthStore();
const uiStore = useUiStore();
const router = useRouter();

const reason = computed(() => auth.access?.deniedReason || "No SOAR role is assigned for this workspace yet.");
const siblings = computed(() => auth.organizations.filter((o) => (o.slug || o._id || o.id) !== auth.orgSlug));

const isRetrying = ref(false);
async function retry() {
  isRetrying.value = true;
  try {
    await auth.resolveAccess();
    if (auth.access?.allowed) router.push({ name: "overview" });
  } finally {
    isRetrying.value = false;
  }
}

async function switchTo(org: { slug?: string; _id?: string; id?: string }) {
  const slug = org.slug || org._id || org.id || "";
  if (!slug) return;
  await auth.switchWorkspace(slug);
  // Full reload so every store re-fetches clean against the new workspace —
  // same pattern AppShell.vue's onSwitchWorkspace uses.
  window.location.reload();
}

function signOut() {
  auth.clearSession();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-4" :style="{ backgroundColor: uiStore.activeTheme.bg }">
    <div class="p-8 rounded-2xl border max-w-md w-full shadow-2xl text-center bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <div class="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-500/15">
        <component :is="ICONS.ShieldWarning" :size="22" weight="Bold" class="text-red-500" />
      </div>
      <h1 class="text-lg font-bold mb-2 text-gray-900 dark:text-white">Access not configured</h1>
      <p class="text-xs leading-relaxed mb-6 text-gray-500 dark:text-gray-400">{{ reason }}</p>

      <div v-if="siblings.length" class="mb-4 space-y-1.5">
        <p class="text-[10px] uppercase tracking-wide font-semibold mb-1.5 text-gray-500 dark:text-gray-400">Try another workspace</p>
        <button
          v-for="org in siblings"
          :key="org.slug || org._id || org.id"
          type="button"
          class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:border-brand-500"
          @click="switchTo(org)"
        >
          {{ org.name }} <span class="text-gray-500 dark:text-gray-400">{{ org.slug }}</span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          :disabled="isRetrying"
          @click="retry"
        >
          {{ isRetrying ? "Checking…" : "Retry" }}
        </button>
        <button
          type="button"
          class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          @click="signOut"
        >
          Sign out
        </button>
      </div>
    </div>
  </div>
</template>
