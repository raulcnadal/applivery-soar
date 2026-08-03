<script setup lang="ts">
// Top nav shell — 1:1 port of App.jsx's top `<nav>` bar (wow-dashboard/src/App.jsx
// ~4344-4460): a full-width h-16 (64px) blue bar (PRIMARY_BLUE #0241E3) with the
// Applivery logo + "SOAR" wordmark and feature-gated nav tabs on the left, and a
// workspace switcher + avatar dropdown (Audit Logs / workspace list / sign out) on
// the right — replacing the earlier left-sidebar layout, which never matched the
// original design.
import { Widget, Smartphone, ShieldWarning, Folder, Routing, FileText, Settings, History, Logout } from "@solar-icons/vue";
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { useAuthStore, type FeatureArea } from "../stores/auth";
import { api } from "../api/http";
import WorkspaceOnboardingModal from "../components/onboarding/WorkspaceOnboardingModal.vue";
// Lazy-loaded — Settings pulls in ~20 sub-panels' worth of code that most
// sessions never open; keeping it out of the eagerly-loaded shell chunk
// matches how every other view is already route-level code-split.
const SettingsModal = defineAsyncComponent(() => import("../components/settings/SettingsModal.vue"));

const PRIMARY_BLUE = "#0241E3";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// New-workspace onboarding (main.py:1802-1811's workspace-status check) —
// checked once per landing (fresh login, or after a workspace switch's full
// reload — both are a fresh AppShell mount, so a single mount-time effect
// covers both). Only offered once per still-empty workspace per browser;
// dismissing it sets a per-workspace localStorage flag (see
// WorkspaceOnboardingModal.vue's dismissForThisWorkspace).
const isOnboardingModalOpen = ref(false);
onMounted(async () => {
  if (!auth.orgSlug) return;
  try {
    if (localStorage.getItem(`applivery_onboarding_dismissed_${auth.orgSlug}`) === "1") return;
  } catch {
    /* ignore */
  }
  try {
    const res = await api.get("/config/workspace-status");
    if (res.data?.isEmpty) isOnboardingModalOpen.value = true;
  } catch {
    // non-critical — just skip onboarding if the check fails
  }
});

interface NavTab {
  id: string;
  label: string;
  icon: any;
  area?: FeatureArea;
}
const NAV_TABS: NavTab[] = [
  { id: "overview", label: "Overview", icon: Widget },
  { id: "devices", label: "Devices", icon: Smartphone, area: "devices" },
  { id: "compliance", label: "Compliance", icon: ShieldWarning, area: "compliance" },
  { id: "cases", label: "Cases", icon: Folder, area: "cases" },
  { id: "workflows", label: "Workflows", icon: Routing, area: "workflows" },
  { id: "reporting", label: "Reporting", icon: FileText, area: "reporting" },
  // Not present in the original app (added during migration) — kept as a
  // trailing tab rather than dropped, since it has no original-design
  // equivalent to fold into.
  { id: "playground", label: "Playground", icon: Widget },
];
const visibleTabs = computed(() => NAV_TABS.filter((t) => !t.area || auth.hasFeatureAccess(t.area, "read")));

const activeId = computed(() => (typeof route.name === "string" ? route.name : "overview"));
function goTo(id: string) {
  router.push({ name: id });
}

// Settings is a modal overlay on top of whatever page is currently open —
// not a routable page — matching the original (App.jsx's isSettingsModalOpen
// state, opened from this same gear icon, App.jsx:4377-4382).
const isSettingsModalOpen = ref(false);

const userDisplayName = computed(() => auth.fullName || auth.email || "");
const userInitials = computed(() => {
  const name = userDisplayName.value;
  if (!name) return "??";
  return name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase() || "??";
});
const workspaceName = computed(() => auth.organizations.find((o) => (o.slug || o._id || o.id) === auth.orgSlug)?.name || auth.orgSlug || "Workspace");

const isWorkspaceMenuOpen = ref(false);
function closeWorkspaceMenu() {
  isWorkspaceMenuOpen.value = false;
}

async function onSwitchWorkspace(slug: string) {
  if (!slug || slug === auth.orgSlug) return;
  closeWorkspaceMenu();
  await auth.switchWorkspace(slug);
  // Full reload so every store re-fetches clean against the new workspace.
  window.location.reload();
}

function signOut() {
  auth.clearSession();
  router.push({ name: "login" });
}

// Same reasoning as handleSwitchOrganization elsewhere — a full reload after
// a config clone is the simplest way to guarantee every store re-fetches
// against the now-populated workspace.
function onCloned() {
  isOnboardingModalOpen.value = false;
  window.location.reload();
}
</script>

<template>
  <div class="w-full h-screen flex flex-col overflow-hidden">
    <nav class="h-16 min-h-16 flex items-center justify-between pl-4 pr-4 z-50 shrink-0 relative" :style="{ backgroundColor: PRIMARY_BLUE }">
      <div class="flex items-center h-full">
        <div class="flex items-center gap-3 mr-4 shrink-0">
          <img src="https://dashboard.applivery.io/images/logo-combined-white.svg" class="h-[22px] object-contain block" alt="Applivery" />
          <div class="h-4 w-px bg-white/25" />
          <span class="text-[19px] text-white/90 select-none" style="font-family: 'Outfit', sans-serif; font-weight: 300; letter-spacing: -0.1px">SOAR</span>
        </div>

        <div class="flex items-center h-full gap-1">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            type="button"
            class="relative flex h-10 items-center gap-2 rounded-md px-4 text-[15px] font-light leading-none transition select-none text-white"
            :class="activeId === tab.id ? 'bg-white/15' : 'bg-transparent hover:bg-white/10'"
            @click="goTo(tab.id)"
          >
            <component :is="tab.icon" :size="19" weight="Linear" />
            {{ tab.label }}
          </button>

          <button
            type="button"
            class="relative flex h-10 w-10 items-center justify-center rounded-md transition select-none text-white hover:bg-white/10"
            :class="{ 'bg-white/15': isSettingsModalOpen }"
            title="Settings"
            @click="isSettingsModalOpen = true"
          >
            <Settings :size="19" weight="Linear" />
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <div class="relative ml-1">
          <button type="button" class="contents" @click="isWorkspaceMenuOpen = !isWorkspaceMenuOpen">
            <div
              class="relative flex h-12 cursor-pointer items-center justify-between rounded-md px-3 text-left transition-colors"
              :class="isWorkspaceMenuOpen ? 'bg-white/20' : 'bg-white/10 hover:bg-white/15'"
            >
              <div class="mr-3">
                <div class="text-[10px] tracking-wider text-white/80 uppercase">Workspace</div>
                <div class="truncate font-light max-w-[160px] text-white">{{ workspaceName }}</div>
              </div>
              <div class="relative flex-none overflow-hidden bg-white w-8 h-8 ring-2 ring-inset ring-slate-200/40 rounded-full">
                <div class="flex h-full w-full items-center justify-center uppercase bg-emerald-800 text-emerald-200/80 text-xs">
                  {{ userInitials }}
                </div>
              </div>
            </div>
          </button>

          <div v-if="isWorkspaceMenuOpen" class="fixed inset-0 z-[199]" @click="closeWorkspaceMenu" />
          <div v-if="isWorkspaceMenuOpen" class="absolute right-0 top-full mt-2 w-64 rounded-xl shadow-xl overflow-hidden z-[200] border border-gray-100 bg-white">
            <button
              type="button"
              class="w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-black/5"
              @click="closeWorkspaceMenu(); goTo('audit-logs')"
            >
              <History :size="15" weight="Linear" class="text-gray-400" />
              <span class="text-[14px] font-normal text-gray-900">Audit Logs</span>
            </button>

            <template v-if="auth.organizations.length > 1">
              <div class="h-px bg-gray-100" />
              <div class="px-4 pt-2.5 pb-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Workspaces</span>
              </div>
              <div class="max-h-52 overflow-y-auto pb-1">
                <button
                  v-for="org in auth.organizations"
                  :key="org.id || org._id || org.slug"
                  type="button"
                  class="w-full text-left px-4 py-2 flex items-center gap-2.5 transition-colors hover:bg-black/5"
                  @click="onSwitchWorkspace(org.slug || org._id || org.id || '')"
                >
                  <div class="shrink-0 w-6 h-6 rounded-md overflow-hidden flex items-center justify-center text-white text-[10px] font-bold" :style="{ backgroundColor: PRIMARY_BLUE }">
                    {{ (org.name || "?").slice(0, 2).toUpperCase() }}
                  </div>
                  <span
                    class="text-[13px] truncate flex-1"
                    :style="{ color: (org.slug || org._id || org.id) === auth.orgSlug ? PRIMARY_BLUE : '#111827', fontWeight: (org.slug || org._id || org.id) === auth.orgSlug ? 600 : 400 }"
                  >
                    {{ org.name }}
                  </span>
                  <svg
                    v-if="(org.slug || org._id || org.id) === auth.orgSlug"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    :stroke="PRIMARY_BLUE"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="shrink-0"
                  >
                    <polyline points="20 6 9 17 4 12" /></svg>
                </button>
              </div>
            </template>

            <div class="h-px bg-gray-100" />
            <button type="button" class="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-black/5 group" @click="signOut">
              <div class="w-9 h-9 rounded-full flex items-center justify-center uppercase bg-emerald-800 text-emerald-200/80 text-xs shrink-0">
                {{ userInitials }}
              </div>
              <div class="flex flex-col min-w-0 flex-1">
                <span class="text-[14px] font-medium truncate text-gray-900">{{ userDisplayName || "Signed in" }}</span>
                <span class="text-[12px] truncate text-gray-500">{{ auth.email || "" }}</span>
              </div>
              <Logout :size="15" class="text-gray-400 group-hover:text-brand-600 transition-colors shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </nav>

    <main class="flex-1 min-w-0 min-h-0 overflow-y-auto">
      <RouterView />
    </main>

    <WorkspaceOnboardingModal v-if="isOnboardingModalOpen" @close="isOnboardingModalOpen = false" @cloned="onCloned" />
    <SettingsModal v-if="isSettingsModalOpen" @close="isSettingsModalOpen = false" />
  </div>
</template>
