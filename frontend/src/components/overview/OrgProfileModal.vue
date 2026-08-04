<script setup lang="ts">
// 1:1 port of App.jsx's inline "Workspace Profile" modal (~line 5421,
// triggered by `setSelectedOrgProfile(orgProfile)`) — the predefined
// org_profile widget's own dedicated modal, distinct from the generic
// WidgetInfoModal every other widget's ⓘ button opens. `profile` here is
// the RAW Applivery organization API response (GET /organizations/{id},
// plus `.mdmInfo` merged in from GET /organizations/{id}/mdm/) passed
// straight through by the backend (widgets.service.ts's `org_profile`
// branch) as WidgetResponse.orgProfile — not a chart-shaped payload like
// every other widget source, hence the bespoke rendering on both ends.
//
// Rendered at OverviewView.vue's root (sibling of WidgetInfoModal, after
// </GridLayout>), same reasoning as that modal: escapes grid-layout-plus's
// CSS-transform stacking context without needing a Teleport, since it's a
// DOM sibling placed after the grid rather than a descendant of any
// .vgl-item.
defineProps<{ profile: Record<string, any> | null }>();
const emit = defineEmits<{ close: [] }>();

interface UsageLimitRow {
  label: string;
  usage: number;
  limit: number;
  isStorage?: boolean;
}
function usageRows(p: Record<string, any>): UsageLimitRow[] {
  const counts = p.counts ?? {};
  const limits = p.limits ?? {};
  const mdmCounts = counts.mdm ?? {};
  return [
    { label: "Apps", usage: counts.apps || 0, limit: limits.apps || 0 },
    { label: "Installations", usage: counts.builds || 0, limit: limits.installations || limits.builds || 5000 },
    { label: "Collaborators", usage: counts.collaborators || 0, limit: limits.collaborators || 0 },
    { label: "Employees", usage: counts.employees || 0, limit: limits.employees || 0 },
    {
      label: "Devices",
      usage: (mdmCounts.android?.devices || 0) + (mdmCounts.apple?.devices || 0) + (mdmCounts.windows?.devices || 0),
      limit: limits.mdmDevices || 0,
    },
    { label: "Assets storage", usage: mdmCounts.assets?.storage || 0, limit: limits.mdmAssetsStorageSize || 0, isStorage: true },
  ];
}
function pctOf(row: UsageLimitRow): number {
  const usage = parseFloat(String(row.usage)) || 0;
  const limit = parseFloat(String(row.limit)) || 0;
  return limit > 0 ? Math.min((usage / limit) * 100, 100) : 0;
}
</script>

<template>
  <div v-if="profile" class="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4" @click="($event.target === $event.currentTarget) && emit('close')">
    <div class="w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <div class="flex justify-between items-center p-6 border-b shrink-0 border-gray-200 dark:border-gray-700">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">Workspace Profile</h2>
        <button type="button" class="text-gray-400 hover:text-red-500 transition-colors" @click="emit('close')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" /></svg>
        </button>
      </div>

      <div class="p-8 overflow-y-auto flex-1">
        <!-- Branding header -->
        <div class="flex flex-col items-center justify-center mb-10">
          <img v-if="profile.branding?.logo" :src="profile.branding.logo" alt="Logo" class="h-20 object-contain mb-4" />
          <div v-else class="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 bg-brand-600/15">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-brand-600"><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2" stroke-linecap="round" /></svg>
          </div>
          <h2 class="text-2xl font-black text-center text-gray-900 dark:text-white">{{ profile.name }}</h2>
          <p class="text-sm font-medium text-center mt-1 text-gray-500 dark:text-gray-400">{{ profile.slug }}</p>
          <div class="flex items-center gap-3 mt-4">
            <span class="px-3 py-1 rounded-full text-[10px] font-light border capitalize border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400">{{ profile.type || "Company" }}</span>
            <span class="px-3 py-1 rounded-full text-[10px] font-light bg-brand-600 text-white capitalize">Plan: {{ (profile.lastPlan || "Enterprise").replace("-", " ") }}</span>
          </div>
        </div>

        <!-- Usage, allows and limits -->
        <div class="mb-10">
          <h3 class="text-[11px] font-bold uppercase tracking-widest mb-6 text-gray-500 dark:text-gray-400">Usage, allows and limits</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
            <div v-for="row in usageRows(profile)" :key="row.label" class="space-y-2">
              <div class="flex justify-between items-baseline">
                <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ row.label }}</span>
                <span class="text-sm font-bold text-gray-900 dark:text-white">
                  {{ row.usage }}{{ row.isStorage ? " GB" : "" }}
                  <span class="text-xs font-medium opacity-40">of {{ row.limit }}{{ row.isStorage ? " GB" : "" }}</span>
                </span>
              </div>
              <div class="w-full h-1.5 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                <div class="h-full bg-blue-600 rounded-full transition-all duration-500" :style="{ width: pctOf(row) + '%' }" />
              </div>
            </div>
          </div>
        </div>

        <!-- UEM Ecosystem & Policies -->
        <div v-if="profile.mdmInfo" class="mb-10">
          <h3 class="text-[11px] font-bold uppercase tracking-widest mb-6 text-gray-500 dark:text-gray-400">UEM Ecosystem &amp; Policies</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="p-4 rounded-xl border bg-gray-50 dark:bg-black/20 border-gray-200 dark:border-gray-700">
              <div class="flex items-center gap-2 mb-3">
                <span class="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style="background-color: #1d1d1f">
                  <svg viewBox="0 0 14 14" width="9" height="9" fill="white"><path d="M11.05 7.44c-.02-1.88 1.54-2.79 1.61-2.83-.88-1.28-2.24-1.46-2.72-1.48-1.16-.12-2.26.68-2.85.68-.59 0-1.51-.66-2.48-.64-1.27.02-2.44.74-3.09 1.87C.05 7.04.92 10.5 2.38 12.37c.72.99 1.57 2.1 2.69 2.06 1.08-.04 1.49-.7 2.79-.7 1.3 0 1.67.7 2.81.68 1.16-.02 1.89-1.01 2.6-2 .82-1.14 1.16-2.26 1.18-2.32-.03-.01-2.38-.91-2.4-2.65zM9.07 2.13C9.65 1.43 10.04.48 9.93-.5 9.05-.46 7.98.09 7.37.79c-.55.62-.99 1.59-.87 2.53.98.07 1.97-.47 2.57-1.19z" /></svg>
                </span>
                <span class="text-sm font-bold text-gray-900 dark:text-white">Apple</span>
              </div>
              <div class="text-[11px] space-y-1.5 text-gray-500 dark:text-gray-400">
                <div class="flex justify-between"><span>Devices</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.apple?.devices || 0 }}</span></div>
                <div class="flex justify-between"><span>Enrollments</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.apple?.enrollments || 0 }}</span></div>
                <div class="flex justify-between"><span>Profiles</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.apple?.profiles || 0 }}</span></div>
                <div class="flex justify-between"><span>Policies</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.apple?.policies || 0 }}</span></div>
                <div class="flex justify-between"><span>VPP Apps</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.apple?.applications || 0 }}</span></div>
              </div>
            </div>
            <div class="p-4 rounded-xl border bg-gray-50 dark:bg-black/20 border-gray-200 dark:border-gray-700">
              <div class="flex items-center gap-2 mb-3">
                <span class="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style="background-color: #3ddc84">
                  <svg viewBox="5 4 14 16" width="11" height="11"><path fill="white" d="M6 14C6 10 8.69 8 12 8s6 2 6 6V18H6v-4z" /><path fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" d="M8.5 8.5L7 6" /><path fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" d="M15.5 8.5L17 6" /></svg>
                </span>
                <span class="text-sm font-bold text-gray-900 dark:text-white">Android</span>
              </div>
              <div class="text-[11px] space-y-1.5 text-gray-500 dark:text-gray-400">
                <div class="flex justify-between"><span>Devices</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.android?.devices || 0 }}</span></div>
                <div class="flex justify-between"><span>Tokens</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.android?.pendingEnrollmentTokens || 0 }}</span></div>
                <div class="flex justify-between"><span>Policies</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.android?.policies || 0 }}</span></div>
              </div>
            </div>
            <div class="p-4 rounded-xl border bg-gray-50 dark:bg-black/20 border-gray-200 dark:border-gray-700">
              <div class="flex items-center gap-2 mb-3">
                <span class="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style="background-color: #0078d4">
                  <svg viewBox="0 0 24 24" width="9" height="9" fill="white"><path d="M0 3.449L9.75 2.1v9.451H0V3.449zm10.949-1.51L24 0v11.4H10.949V1.939zM0 12.6h9.75v9.451L0 20.699V12.6zm10.949.6H24V24l-13.051-1.699V13.2z" /></svg>
                </span>
                <span class="text-sm font-bold text-gray-900 dark:text-white">Windows</span>
              </div>
              <div class="text-[11px] space-y-1.5 text-gray-500 dark:text-gray-400">
                <div class="flex justify-between"><span>Devices</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.windows?.devices || 0 }}</span></div>
                <div class="flex justify-between"><span>Tokens</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.windows?.pendingEnrollmentTokens || 0 }}</span></div>
                <div class="flex justify-between"><span>Policies</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.windows?.policies || 0 }}</span></div>
              </div>
            </div>
            <div class="flex flex-col gap-4">
              <div class="p-4 rounded-xl border flex-1 bg-gray-50 dark:bg-black/20 border-gray-200 dark:border-gray-700">
                <div class="flex items-center gap-2 mb-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="text-brand-600"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                  <span class="text-sm font-bold text-gray-900 dark:text-white">Assets</span>
                </div>
                <div class="text-[11px] space-y-1.5 text-gray-500 dark:text-gray-400">
                  <div class="flex justify-between"><span>Enterprise Apps</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.assets?.apps || 0 }}</span></div>
                  <div class="flex justify-between"><span>Scripts</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.assets?.scripts || 0 }}</span></div>
                  <div class="flex justify-between"><span>Certificates</span><span class="font-bold text-gray-900 dark:text-white">{{ profile.mdmInfo.assets?.certificates || 0 }}</span></div>
                </div>
              </div>
              <div class="p-4 rounded-xl border bg-gray-50 dark:bg-black/20 border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="text-emerald-500"><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke-linecap="round" /><circle cx="17" cy="9" r="2.5" /><path d="M15 20c.3-2.8 2.2-5 4.5-5.5" stroke-linecap="round" /></svg>
                    <span class="text-sm font-bold text-gray-900 dark:text-white">Users</span>
                  </div>
                  <span class="text-sm font-black text-gray-900 dark:text-white">{{ profile.mdmInfo.users || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-10 border-t pt-8 border-gray-200 dark:border-gray-700">
          <div class="space-y-4">
            <h3 class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Platform Privileges</h3>
            <div class="flex flex-wrap gap-2">
              <span v-if="profile.allows?.ssoLogin" class="px-2 py-1 text-[9px] font-bold rounded bg-purple-500/15 text-purple-500 uppercase">SSO Login</span>
              <span v-if="profile.allows?.customBranding" class="px-2 py-1 text-[9px] font-bold rounded bg-blue-500/15 text-blue-500 uppercase">Custom Branding</span>
              <span v-if="profile.allows?.androidAgent" class="px-2 py-1 text-[9px] font-bold rounded bg-green-500/15 text-green-500 uppercase">Android Agent</span>
              <span v-if="profile.allows?.iosAgent" class="px-2 py-1 text-[9px] font-bold rounded bg-slate-500/15 text-slate-500 uppercase">iOS Agent</span>
            </div>
          </div>
          <div class="space-y-4">
            <h3 class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Contact Details</h3>
            <div class="space-y-2">
              <div class="flex justify-between items-center"><span class="text-xs text-gray-500 dark:text-gray-400">Email</span><span class="text-xs font-medium text-gray-900 dark:text-white">{{ profile.contactInfo?.email || "—" }}</span></div>
              <div class="flex justify-between items-center"><span class="text-xs text-gray-500 dark:text-gray-400">Support Phone</span><span class="text-xs font-medium text-gray-900 dark:text-white">{{ profile.contactInfo?.phoneNumber || "—" }}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="p-6 border-t shrink-0 flex justify-center bg-gray-50/50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700">
        <p class="text-[10px] font-medium uppercase tracking-widest opacity-40">Workspace ID: {{ profile.id }}</p>
      </div>
    </div>
  </div>
</template>
