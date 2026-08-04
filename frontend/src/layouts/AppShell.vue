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
import { useSegmentsStore } from "../stores/segments";
import { useUiStore, type ThemeMode } from "../stores/ui";
import { useDashboardStateStore } from "../stores/dashboardState";
import { ICONS } from "../lib/solarIcons";
import { api } from "../api/http";
import WorkspaceOnboardingModal from "../components/onboarding/WorkspaceOnboardingModal.vue";
import SegmentsPanel from "../components/shared/SegmentsPanel.vue";

// Views the Segments panel is reachable from (App.jsx:4462's currentView
// check) — Overview/Devices/Compliance/Cases only.
const SEGMENT_PANEL_VIEWS = ["overview", "devices", "compliance", "cases"];
// Lazy-loaded — Settings pulls in ~20 sub-panels' worth of code that most
// sessions never open; keeping it out of the eagerly-loaded shell chunk
// matches how every other view is already route-level code-split.
const SettingsModal = defineAsyncComponent(() => import("../components/settings/SettingsModal.vue"));

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const segmentsStore = useSegmentsStore();
const uiStore = useUiStore();
const dashboardStateStore = useDashboardStateStore();
// Guarded defensively — AppShell is only ever supposed to mount for an
// authenticated session (App.vue renders it unless the route is standalone),
// but a brief router race on first paint could still get here unauthenticated
// (see main.ts's router.isReady() comment). An unauthenticated fetchTree()
// call 401s, which api.ts's interceptor turns into a hard `location.href`
// reload — restarting that race forever. Cheap to guard here too.
if (auth.isAuthenticated) segmentsStore.fetchTree();

// New-workspace onboarding (main.py:1802-1811's workspace-status check) —
// checked once per landing (fresh login, or after a workspace switch's full
// reload — both are a fresh AppShell mount, so a single mount-time effect
// covers both). Only offered once per still-empty workspace per browser;
// dismissing it sets a per-workspace localStorage flag (see
// WorkspaceOnboardingModal.vue's dismissForThisWorkspace).
const isOnboardingModalOpen = ref(false);
onMounted(async () => {
  // Same guard as the fetchTree() call above — see its comment.
  if (!auth.isAuthenticated) return;

  // Backend-persisted theme (roadmap Phase 11) — the localStorage value
  // ui.ts read at store-creation time is already applied (no flash of the
  // wrong theme), this just reconciles against the cross-device value once
  // it's available. Also warms dashboardState for OverviewView, which
  // guards its own fetchState() call behind `isLoaded`, so this doesn't
  // cause a duplicate request.
  if (!dashboardStateStore.isLoaded) await dashboardStateStore.fetchState();
  uiStore.syncFromBackend(dashboardStateStore.themeMode);

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

// ── Footer: theme selector + status + operational pill — 1:1 port of
// App.jsx's <footer> (~5280-5350), previously entirely unported. Fixed to
// the viewport bottom on every authenticated page, same as the original. ──
const isThemeMenuOpen = ref(false);
const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: any; label: string }> = [
  { mode: "system", icon: ICONS.Monitor, label: "System default" },
  { mode: "light", icon: ICONS.Sun, label: "Light mode" },
  { mode: "dark", icon: ICONS.Moon, label: "Dark mode" },
];
const themeIcon = computed(() => (uiStore.themeMode === "light" ? ICONS.Sun : uiStore.themeMode === "dark" ? ICONS.Moon : ICONS.Monitor));
function chooseTheme(mode: ThemeMode) {
  uiStore.setThemeMode(mode);
  isThemeMenuOpen.value = false;
}
// Port of App.jsx's connectionStatus (~2927, set 'ONLINE' once apiToken +
// orgSlug are both present, App.jsx:3427/3578) — a "session is fully
// established" signal, not a live health-check ping.
const connectionStatus = computed(() => (auth.apiToken && auth.orgSlug ? "ONLINE" : "OFFLINE"));
const FOOTER_LINKS: Array<{ label: string; href: string | null }> = [
  { label: "Documentation", href: "https://www.applivery.com/docs/" },
  { label: "Legal", href: "https://www.applivery.com/legal/terms-of-service/" },
  { label: "Service status", href: null },
];

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
              <div class="relative flex-none overflow-hidden bg-white dark:bg-gray-800 w-8 h-8 ring-2 ring-inset ring-slate-200/40 rounded-full">
                <div class="flex h-full w-full items-center justify-center uppercase bg-emerald-800 text-emerald-200/80 text-xs">
                  {{ userInitials }}
                </div>
              </div>
            </div>
          </button>

          <div v-if="isWorkspaceMenuOpen" class="fixed inset-0 z-[199]" @click="closeWorkspaceMenu" />
          <div v-if="isWorkspaceMenuOpen" class="absolute right-0 top-full mt-2 w-64 rounded-xl shadow-xl overflow-hidden z-[200] border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800">
            <button
              type="button"
              class="w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              @click="closeWorkspaceMenu(); goTo('audit-logs')"
            >
              <History :size="15" weight="Linear" class="text-gray-400" />
              <span class="text-[14px] font-normal text-gray-900 dark:text-white">Audit Logs</span>
            </button>

            <template v-if="auth.organizations.length > 1">
              <div class="h-px bg-gray-100 dark:bg-gray-700" />
              <div class="px-4 pt-2.5 pb-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Workspaces</span>
              </div>
              <div class="max-h-52 overflow-y-auto pb-1">
                <button
                  v-for="org in auth.organizations"
                  :key="org.id || org._id || org.slug"
                  type="button"
                  class="w-full text-left px-4 py-2 flex items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  @click="onSwitchWorkspace(org.slug || org._id || org.id || '')"
                >
                  <div class="shrink-0 w-6 h-6 rounded-md overflow-hidden flex items-center justify-center text-white text-[10px] font-bold" :style="{ backgroundColor: PRIMARY_BLUE }">
                    {{ (org.name || "?").slice(0, 2).toUpperCase() }}
                  </div>
                  <span
                    class="text-[13px] truncate flex-1"
                    :class="(org.slug || org._id || org.id) !== auth.orgSlug ? 'text-gray-900 dark:text-white' : ''"
                    :style="{ color: (org.slug || org._id || org.id) === auth.orgSlug ? PRIMARY_BLUE : undefined, fontWeight: (org.slug || org._id || org.id) === auth.orgSlug ? 600 : 400 }"
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

            <div class="h-px bg-gray-100 dark:bg-gray-700" />
            <button type="button" class="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5 group" @click="signOut">
              <div class="w-9 h-9 rounded-full flex items-center justify-center uppercase bg-emerald-800 text-emerald-200/80 text-xs shrink-0">
                {{ userInitials }}
              </div>
              <div class="flex flex-col min-w-0 flex-1">
                <span class="text-[14px] font-medium truncate text-gray-900 dark:text-white">{{ userDisplayName || "Signed in" }}</span>
                <span class="text-[12px] truncate text-gray-500 dark:text-gray-400">{{ auth.email || "" }}</span>
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
    <SegmentsPanel :views="SEGMENT_PANEL_VIEWS" :current-view="activeId" />

    <!-- Footer — theme selector + status + operational pill (App.jsx ~5280-5350) -->
    <footer class="fixed bottom-0 left-0 right-0 z-[50] flex items-center justify-between px-6 py-2.5 border-t h-[44px] bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <span class="text-[11px] text-gray-400 dark:text-gray-400">©{{ new Date().getFullYear() }} Applivery S.L. All rights reserved</span>

      <div class="flex items-center gap-4">
        <template v-for="link in FOOTER_LINKS" :key="link.label">
          <a v-if="link.href" :href="link.href" target="_blank" rel="noopener noreferrer" class="text-[11px] hover:opacity-80 transition-opacity hidden sm:block text-gray-400 dark:text-gray-400" style="text-decoration: none">{{ link.label }}</a>
          <span v-else class="text-[11px] cursor-pointer hover:opacity-80 transition-opacity hidden sm:block text-gray-400 dark:text-gray-400">{{ link.label }}</span>
        </template>

        <!-- Operational pill -->
        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border" :style="{ backgroundColor: `${SUCCESS}12`, borderColor: `${SUCCESS}30` }">
          <div class="h-1.5 w-1.5 rounded-full" :class="connectionStatus === 'ONLINE' ? 'bg-emerald-500' : 'bg-red-500'" :style="{ boxShadow: connectionStatus === 'ONLINE' ? '0 0 5px #22c55e' : 'none' }" />
          <span class="text-[10px] font-semibold" :style="{ color: SUCCESS }">{{ connectionStatus === "ONLINE" ? "Operational" : connectionStatus }}</span>
        </div>

        <!-- Language stub -->
        <div class="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity text-gray-400 dark:text-gray-400">
          <component :is="ICONS.Global" :size="13" weight="Linear" />
          <span class="text-[11px]">English</span>
        </div>

        <!-- Theme toggle -->
        <div class="relative flex items-center">
          <button type="button" class="flex items-center justify-center w-7 h-7 rounded-md transition hover:opacity-70 text-gray-400 dark:text-gray-400" @click="isThemeMenuOpen = !isThemeMenuOpen">
            <component :is="themeIcon" :size="14" weight="Linear" />
          </button>
          <div v-if="isThemeMenuOpen" class="fixed inset-0 z-[199]" @click="isThemeMenuOpen = false" />
          <div v-if="isThemeMenuOpen" class="absolute right-0 bottom-full mb-2 w-48 rounded-xl shadow-xl overflow-hidden z-[200] border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <button
              v-for="opt in THEME_OPTIONS"
              :key="opt.mode"
              type="button"
              class="w-full text-left px-4 py-3 text-sm flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-gray-900 dark:text-white"
              @click="chooseTheme(opt.mode)"
            >
              <component :is="opt.icon" :size="14" weight="Linear" />
              {{ opt.label }}
              <component v-if="uiStore.themeMode === opt.mode" :is="ICONS.CheckCircle" :size="13" weight="Linear" class="ml-auto" :style="{ color: PRIMARY_BLUE }" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
