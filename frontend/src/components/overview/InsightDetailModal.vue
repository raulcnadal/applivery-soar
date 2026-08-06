<script setup lang="ts">
// The `activeInsight` drill-in detail modal for chart-click results that
// AREN'T device-shaped — App.jsx's renderInsightContent (~3988-4270),
// dispatched by insightKind() (lib/widgetVisuals.ts's 1:1 port of the same
// shape-sniffing renderInsightContent does inline). Device-shaped items
// instead reuse devices/DeviceDetailDrawer.vue — the same merged device
// modal the Devices view and Playground globe/map pins also open — see
// OverviewView.vue's activeInsight wiring for the branch.
import { computed } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { colorFor, insightKind } from "../../lib/widgetVisuals";
import { useUiStore } from "../../stores/ui";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";

const props = defineProps<{ insight: Record<string, any> | null; widgetStat: string }>();
const emit = defineEmits<{ close: [] }>();

const uiStore = useUiStore();
const theme = computed(() => uiStore.activeTheme);

const kind = computed(() => (props.insight ? insightKind(props.insight) : null));

// ── Segment ──
const segment = computed(() => props.insight ?? {});

// ── Download ──
const download = computed(() => props.insight ?? {});
const downloadName = computed(() => {
  const dl = download.value;
  return `${dl.member?.firstName || ""} ${dl.member?.lastName || ""}`.trim() || dl.member?.email || "Unknown Downloader";
});
const downloadOs = computed(() => download.value.build?.os || "unknown");

// ── Build ──
const build = computed(() => props.insight ?? {});
const buildOs = computed(() => build.value.platform_normalized || "other");

// ── Generic user (collaborator / role / store user / UEM user) ──
const u = computed(() => props.insight ?? {});
const widgetStat = computed(() => props.widgetStat || "");
const isUEMCollab = computed(() => widgetStat.value === "mdm_collaborators" || widgetStat.value === "mdm_users");
const isDistCollab = computed(() => widgetStat.value === "app_dist_collaborators" || widgetStat.value === "stats_collaborators");
const isStoreUser = computed(() => widgetStat.value === "app_dist_store_users");

const userTarget = computed(() => u.value.user || u.value.employee || u.value.mdmUser || u.value);
const userName = computed(() => {
  const target = userTarget.value;
  const empSub = u.value.employee || {};
  const userSub = u.value.user || {};
  const firstName = target.firstName || empSub.firstName || userSub.firstName || u.value.firstName || "";
  const lastName = target.lastName || empSub.lastName || userSub.lastName || u.value.lastName || "";
  let name = `${firstName} ${lastName}`.trim();
  if (!name) name = u.value.display_name || u.value.displayName || target.name || u.value.name || target.email || u.value.email || "Unknown";
  return name;
});
const userEmail = computed(() => {
  const target = userTarget.value;
  const empSub = u.value.employee || {};
  const userSub = u.value.user || {};
  return target.email || empSub.email || userSub.email || u.value.email || "No email";
});
const userPicture = computed(() => userTarget.value.picture || u.value.picture || "");
const userLanguage = computed(() => userTarget.value.language || u.value.language || "EN");
const userCreatedAt = computed(() => (userTarget.value.createdAt || u.value.createdAt || "").split("T")[0]);
const userTags = computed<any[]>(() => u.value.tags || userTarget.value.tags || []);
const userIsSSO = computed(() => u.value.sso_normalized || userTarget.value.ssoUser || false);
const distRole = computed(() => u.value.role_normalized || userTarget.value.role || "");
const segmentRole = computed(() => u.value.segmentRole || u.value.segmentPermissions || "");
const actTrace = computed(() => userTarget.value.activityTrace || u.value.activityTrace || {});
const lastDashLogin = computed(() => actTrace.value.lastLogin?.dashboard || "");
const lastStoreLogin = computed(() => actTrace.value.lastLogin?.store || "");
const androidDevices = computed(() => u.value.android?.devices || {});
const appleDevices = computed(() => u.value.apple?.devices);
const winDevices = computed(() => u.value.windows?.devices);
const contextLabel = computed(() => (isStoreUser.value ? "STORE USER" : isDistCollab.value ? "APP DISTRIBUTION" : isUEMCollab.value ? "UEM COLLABORATOR" : "USER"));
const contextColor = computed(() => (isStoreUser.value ? "#10B981" : isDistCollab.value ? "#A855F7" : PRIMARY_BLUE));

// ── App (reduced scope — see comment on the template branch below) ──
const app = computed(() => props.insight ?? {});
const appCounts = computed(() => app.value.counts || {});

function osColor(os: string) {
  return colorFor("", os, 0, uiStore.isDark);
}
function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit("close");
}
</script>

<template>
  <div v-if="insight" class="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4" @click="onOverlayClick">
    <div class="w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh]" :style="{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }">
      <div class="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0" :style="{ borderColor: theme.border }">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center" :style="{ backgroundColor: `${PRIMARY_BLUE}15` }">
            <component :is="ICONS.InfoCircle" :size="18" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
          </div>
          <h2 class="text-base font-bold" :style="{ color: theme.text }">Details</h2>
        </div>
        <button type="button" class="w-8 h-8 flex items-center justify-center rounded-full hover:opacity-70 transition-opacity" :style="{ color: theme.textMuted, backgroundColor: `${theme.textMuted}12` }" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="15" weight="Linear" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-6">
        <!-- Segment — App.jsx ~3990-4014 -->
        <div v-if="kind === 'segment'" class="space-y-6">
          <div class="flex items-center gap-4 border-b pb-6" :style="{ borderColor: theme.border }">
            <div class="w-16 h-16 rounded-2xl flex items-center justify-center" :style="{ backgroundColor: segment.color ? `${segment.color}15` : `${PRIMARY_BLUE}15`, color: segment.color || PRIMARY_BLUE }">
              <component :is="ICONS.Widget2" :size="28" weight="Linear" />
            </div>
            <div>
              <h3 class="text-xl font-bold" :style="{ color: theme.text }">{{ segment.name || "Unnamed Segment" }}</h3>
              <p class="text-sm" :style="{ color: theme.textMuted }">ID: {{ segment.id }}</p>
              <span class="inline-block mt-2 px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">Segment</span>
            </div>
          </div>
          <div>
            <h4 class="text-[10px] font-bold uppercase tracking-widest mb-3" :style="{ color: theme.textMuted }">Details</h4>
            <div class="p-4 rounded-xl border space-y-3" :style="{ backgroundColor: theme.bg, borderColor: theme.border }">
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Sub-Segments</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ segment.children?.length || 0 }}</span></div>
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Color Code</span><span class="text-sm font-medium font-mono" :style="{ color: theme.text }">{{ segment.color || "Default" }}</span></div>
            </div>
          </div>
        </div>

        <!-- Download — App.jsx ~4016-4046 -->
        <div v-else-if="kind === 'download'" class="space-y-6">
          <div class="flex items-center gap-4 border-b pb-6" :style="{ borderColor: theme.border }">
            <div class="w-16 h-16 rounded-2xl flex items-center justify-center" :style="{ backgroundColor: `${osColor(downloadOs)}15` }">
              <component :is="ICONS.Smartphone" :size="32" weight="Linear" :style="{ color: osColor(downloadOs) }" />
            </div>
            <div>
              <h3 class="text-xl font-bold" :style="{ color: theme.text }">{{ downloadName }}</h3>
              <p class="text-sm" :style="{ color: theme.textMuted }">{{ download.applicationInfo?.name || "App Download" }}</p>
              <div class="flex gap-2 mt-2">
                <span class="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" :style="{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }">v{{ download.build?.versionName }}</span>
                <span class="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25 capitalize" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">{{ download.from }}</span>
              </div>
            </div>
          </div>
          <div>
            <h4 class="text-[10px] font-bold uppercase tracking-widest mb-3" :style="{ color: theme.textMuted }">Network &amp; Location</h4>
            <div class="p-4 rounded-xl border space-y-3" :style="{ backgroundColor: theme.bg, borderColor: theme.border }">
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">IP Address</span><span class="text-sm font-medium font-mono" :style="{ color: theme.text }">{{ download.networkInfo?.ip || "—" }}</span></div>
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Location</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ [download.networkInfo?.city, download.networkInfo?.country].filter(Boolean).join(", ") || "—" }}</span></div>
            </div>
          </div>
          <div>
            <h4 class="text-[10px] font-bold uppercase tracking-widest mb-3" :style="{ color: theme.textMuted }">Device Details</h4>
            <div class="p-4 rounded-xl border space-y-3" :style="{ backgroundColor: theme.bg, borderColor: theme.border }">
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Model</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ download.device?.model || "—" }}</span></div>
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">OS Version</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ download.os?.name || downloadOs }} {{ download.os?.version || "" }}</span></div>
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Downloaded At</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ download.createdAt ? download.createdAt.split("T")[0] + " " + download.createdAt.split("T")[1]?.substring(0, 5) : "—" }}</span></div>
            </div>
          </div>
        </div>

        <!-- Build — App.jsx ~4048-4075 -->
        <div v-else-if="kind === 'build'" class="space-y-6">
          <div class="flex items-center gap-4 border-b pb-6" :style="{ borderColor: theme.border }">
            <div class="w-16 h-16 rounded-2xl flex items-center justify-center" :style="{ backgroundColor: `${osColor(buildOs)}15` }">
              <component :is="ICONS.Box" :size="32" weight="Linear" :style="{ color: osColor(buildOs) }" />
            </div>
            <div>
              <h3 class="text-xl font-bold" :style="{ color: theme.text }">{{ build.applicationInfo?.name || "App Build" }}</h3>
              <p class="text-sm" :style="{ color: theme.textMuted }">Version: {{ build.versionName }} ({{ build.versionCode }})</p>
              <div class="flex gap-2 mt-2">
                <span class="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25 capitalize" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">{{ buildOs }}</span>
                <span class="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25 capitalize" :style="{ backgroundColor: build.status === 'processed' ? `${SUCCESS}15` : `${WARNING}15`, color: build.status === 'processed' ? SUCCESS : WARNING }">{{ build.status }}</span>
              </div>
            </div>
          </div>
          <div>
            <h4 class="text-[10px] font-bold uppercase tracking-widest mb-3" :style="{ color: theme.textMuted }">Build Details</h4>
            <div class="p-4 rounded-xl border space-y-3" :style="{ backgroundColor: theme.bg, borderColor: theme.border }">
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Size</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ build.size ? (build.size / 1024 / 1024).toFixed(2) + " MB" : "N/A" }}</span></div>
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Uploaded By</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ build.uploadedBy?.email || "—" }}</span></div>
              <div class="flex justify-between"><span class="text-xs font-medium uppercase" :style="{ color: theme.textMuted }">Created At</span><span class="text-sm font-medium" :style="{ color: theme.text }">{{ build.createdAt ? build.createdAt.split("T")[0] : "—" }}</span></div>
            </div>
          </div>
        </div>

        <!-- Enterprise app — App.jsx's AppBuildInsightCard (~2702-2800) fetches
             its "Latest Builds" list live from the Applivery API using the
             user's own apiToken; that per-app builds list has no backend
             proxy endpoint yet in this migration (unlike device extras,
             which devices.service.ts already proxies — see
             playground/DeviceInsightModal.vue's comment), so this shows the
             same header/counts, minus that one live-fetched subsection. -->
        <div v-else-if="kind === 'app'" class="space-y-5">
          <div class="flex items-center gap-4 pb-4 border-b" :style="{ borderColor: theme.border }">
            <img v-if="app.picture" :src="app.picture" class="w-16 h-16 rounded-2xl object-cover" :alt="app.name" />
            <div v-else class="w-16 h-16 rounded-2xl flex items-center justify-center" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">
              <component :is="ICONS.Box" :size="28" weight="Linear" />
            </div>
            <div class="min-w-0">
              <h3 class="text-lg font-bold truncate" :style="{ color: theme.text }">{{ app.name || "Enterprise App" }}</h3>
              <p class="text-xs font-mono" :style="{ color: theme.textMuted }">{{ app.slug }}</p>
              <div class="flex gap-1.5 mt-1.5 flex-wrap">
                <span v-for="os in app.oss || []" :key="os" class="px-2 py-0.5 text-[9px] font-light rounded-full border border-current/25" :style="{ backgroundColor: `${osColor(os)}15`, color: osColor(os) }">{{ String(os).toUpperCase() }}</span>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div v-for="s in [{ label: 'Builds', val: appCounts.builds || 0 }, { label: 'Downloads', val: appCounts.downloads || 0 }, { label: 'Feedback', val: appCounts.feedbacks || 0 }]" :key="s.label" class="p-3 rounded-xl border text-center" :style="{ backgroundColor: theme.bg, borderColor: theme.border }">
              <div class="text-xl font-black" :style="{ color: PRIMARY_BLUE }">{{ s.val.toLocaleString() }}</div>
              <div class="text-[9px] font-bold uppercase tracking-widest mt-0.5" :style="{ color: theme.textMuted }">{{ s.label }}</div>
            </div>
          </div>
        </div>

        <!-- Generic user: UEM/Distribution collaborator, store user, or role —
             App.jsx ~4111-4270 -->
        <div v-else class="w-full relative space-y-5">
          <div class="flex flex-col items-center gap-2">
            <img v-if="userPicture" :src="userPicture" class="w-20 h-20 rounded-full object-cover shadow-sm" :alt="userName" />
            <div v-else class="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black" :style="{ backgroundColor: `${contextColor}18`, color: contextColor }">
              {{ (userName.charAt(0) || "?").toUpperCase() }}
            </div>
            <div class="text-center">
              <h3 class="text-xl font-bold" :style="{ color: theme.text }">{{ userName }}</h3>
              <p class="text-sm" :style="{ color: theme.textMuted }">{{ userEmail }}</p>
            </div>
            <div class="flex flex-wrap justify-center gap-1.5 mt-1">
              <span class="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" :style="{ backgroundColor: `${contextColor}18`, color: contextColor }">{{ contextLabel }}</span>
              <span class="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">{{ userIsSSO ? "Federated" : "Standard login" }}</span>
              <span v-if="userLanguage" class="px-2.5 py-1 text-[10px] font-light rounded-full border" :style="{ color: theme.textMuted, borderColor: theme.border }">{{ userLanguage.toUpperCase() }}</span>
            </div>
          </div>

          <div v-if="distRole || segmentRole" class="rounded-xl border" :style="{ backgroundColor: theme.bg, borderColor: theme.border }">
            <div v-if="distRole" class="flex justify-between items-center px-4 py-3 border-b" :style="{ borderColor: theme.border }">
              <span class="text-xs font-medium" :style="{ color: theme.textMuted }">{{ isUEMCollab ? "UEM Role" : isDistCollab ? "Distribution Role" : "Role" }}</span>
              <span class="text-xs font-bold uppercase px-2 py-0.5 rounded" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }">{{ distRole }}</span>
            </div>
            <div v-if="segmentRole" class="flex justify-between items-center px-4 py-3">
              <span class="text-xs font-medium" :style="{ color: theme.textMuted }">Segment Role</span>
              <span class="text-xs font-bold uppercase px-2 py-0.5 rounded" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">{{ segmentRole }}</span>
            </div>
          </div>

          <div v-if="isUEMCollab && !isStoreUser && ((typeof appleDevices === 'number' && appleDevices > 0) || (typeof winDevices === 'number' && winDevices > 0) || (androidDevices.DEVICE_OWNER || androidDevices.PROFILE_OWNER || 0) > 0)" class="rounded-xl border overflow-hidden" :style="{ borderColor: theme.border }">
            <div class="px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest border-b" :style="{ color: theme.textMuted, borderColor: theme.border }">Managed Devices</div>
            <div class="flex" :style="{ backgroundColor: theme.bg }">
              <div v-if="typeof appleDevices === 'number' && appleDevices > 0" class="flex-1 flex flex-col items-center py-3 border-r" :style="{ borderColor: theme.border }">
                <component :is="ICONS.Smartphone" :size="16" weight="Linear" :style="{ color: osColor('apple') }" />
                <span class="text-sm font-black mt-1" :style="{ color: theme.text }">{{ appleDevices }}</span>
                <span class="text-[9px]" :style="{ color: theme.textMuted }">Apple</span>
              </div>
              <div v-if="typeof winDevices === 'number' && winDevices > 0" class="flex-1 flex flex-col items-center py-3 border-r" :style="{ borderColor: theme.border }">
                <component :is="ICONS.Smartphone" :size="16" weight="Linear" :style="{ color: osColor('windows') }" />
                <span class="text-sm font-black mt-1" :style="{ color: theme.text }">{{ winDevices }}</span>
                <span class="text-[9px]" :style="{ color: theme.textMuted }">Windows</span>
              </div>
              <div v-if="(androidDevices.DEVICE_OWNER || androidDevices.PROFILE_OWNER || 0) > 0" class="flex-1 flex flex-col items-center py-3">
                <component :is="ICONS.Smartphone" :size="16" weight="Linear" :style="{ color: osColor('android') }" />
                <span class="text-sm font-black mt-1" :style="{ color: theme.text }">{{ (androidDevices.DEVICE_OWNER || 0) + (androidDevices.PROFILE_OWNER || 0) }}</span>
                <span class="text-[9px]" :style="{ color: theme.textMuted }">Android</span>
              </div>
            </div>
          </div>

          <div v-if="userTags.length" class="space-y-2">
            <div class="text-[9px] font-bold uppercase tracking-widest" :style="{ color: theme.textMuted }">Tags</div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="(g, i) in userTags" :key="i" class="px-2 py-0.5 text-[10px] font-medium rounded-full border" :style="{ color: theme.textMuted, borderColor: theme.border }">#{{ typeof g === "string" ? g : g.value || String(g) }}</span>
            </div>
          </div>

          <div class="rounded-xl border overflow-hidden" :style="{ borderColor: theme.border }">
            <div class="px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest border-b" :style="{ color: theme.textMuted, borderColor: theme.border }">Activity Trace</div>
            <div :style="{ backgroundColor: theme.bg }">
              <div class="flex justify-between items-center px-4 py-2.5 border-b" :style="{ borderColor: theme.border }">
                <span class="text-xs" :style="{ color: theme.textMuted }">Created At</span>
                <span class="text-xs font-medium" :style="{ color: theme.text }">{{ userCreatedAt || "—" }}</span>
              </div>
              <div v-if="!isStoreUser" class="flex justify-between items-center px-4 py-2.5 border-b" :style="{ borderColor: theme.border }">
                <span class="text-xs" :style="{ color: theme.textMuted }">Dashboard Login</span>
                <span class="text-xs font-medium" :style="{ color: lastDashLogin ? theme.text : theme.textMuted }">{{ lastDashLogin ? lastDashLogin.split("T")[0] : "Never" }}</span>
              </div>
              <div class="flex justify-between items-center px-4 py-2.5">
                <span class="text-xs" :style="{ color: theme.textMuted }">Store Login</span>
                <span class="text-xs font-medium" :style="{ color: lastStoreLogin ? theme.text : theme.textMuted }">{{ lastStoreLogin ? lastStoreLogin.split("T")[0] : "Never" }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
