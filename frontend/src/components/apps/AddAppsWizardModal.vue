<script setup lang="ts">
// "Add new Apps" wizard — opened from AppCatalogPanel.vue's "Add new Apps"
// button. Two steps: pick a platform, then pick a source for that platform
// and add apps to the Custom Catalog. This is the same functionality that
// used to live inline in AppCatalogPanel.vue's "Search & add to catalog"
// section — moved into a modal per the user's ask, since an always-open
// multi-source search panel made the Apps view feel cluttered next to the
// (naturally longer) catalog list itself.
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { computed, ref, watch } from "vue";
import { ICONS, type IconName } from "../../lib/solarIcons";
import { useComplianceStore } from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useComplianceStore();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS/iPadOS", macos: "macOS", android: "Android", windows: "Windows" };
const PLATFORM_CARDS: Array<{ value: string; label: string; sub: string; icon: IconName }> = [
  { value: "apple", label: "Apple", sub: "iOS/iPadOS", icon: "Smartphone" },
  { value: "macos", label: "macOS", sub: "Mac desktop/laptop", icon: "Monitor" },
  { value: "windows", label: "Windows", sub: "PC desktop/laptop", icon: "Monitor" },
  { value: "android", label: "Android", sub: "Phones & tablets", icon: "Smartphone" },
];

// Mirrors SEARCH_SOURCES_BY_PLATFORM in appSearch.service.ts, plus two
// sources that aren't Applivery search calls at all and are handled
// entirely client-side (see the searchSource branches in the template) —
// see the doc comment this used to carry in AppCatalogPanel.vue for the
// full "reported_apps" / "google_play_lookup" rationale.
const SOURCES_BY_PLATFORM: Record<string, Array<{ id: string; label: string }>> = {
  apple: [
    { id: "reported_apps", label: "From Reported Apps" },
    { id: "apple_store", label: "Apple App Store" },
  ],
  macos: [
    { id: "reported_apps", label: "From Reported Apps" },
    { id: "apple_store", label: "Apple App Store" },
    { id: "homebrew", label: "Homebrew (Cask)" },
  ],
  windows: [
    { id: "reported_apps", label: "From Reported Apps" },
    { id: "ms_store", label: "Microsoft Store" },
    { id: "winget", label: "Winget" },
  ],
  android: [
    { id: "reported_apps", label: "From Reported Apps" },
    { id: "android_known", label: "Applivery Catalog" },
    { id: "google_play_lookup", label: "Google Play (exact package)" },
  ],
};

// Curated starting points — convenience seed, not an authority (spot-check
// before relying on it for enforcement). Windows deliberately omitted — no
// identifier convention confident enough to hardcode.
const PRESETS: Record<string, Array<{ label: string; apps: Array<{ identifier: string; name: string }> }>> = {
  apple: [
    { label: "Common browsers", apps: [
      { identifier: "com.apple.mobilesafari", name: "Safari" },
      { identifier: "com.google.chrome.ios", name: "Chrome" },
      { identifier: "org.mozilla.ios.Firefox", name: "Firefox" },
    ] },
    { label: "Collaboration apps", apps: [
      { identifier: "com.tinyspeck.chatlyio", name: "Slack" },
      { identifier: "us.zoom.videomeetings", name: "Zoom" },
      { identifier: "com.microsoft.skype.teams", name: "Microsoft Teams" },
    ] },
  ],
  macos: [
    { label: "Common browsers", apps: [
      { identifier: "com.apple.Safari", name: "Safari" },
      { identifier: "com.google.Chrome", name: "Chrome" },
      { identifier: "org.mozilla.firefox", name: "Firefox" },
    ] },
    { label: "Collaboration apps", apps: [
      { identifier: "com.tinyspeck.slackmacgap", name: "Slack" },
      { identifier: "us.zoom.xos", name: "Zoom" },
      { identifier: "com.microsoft.teams2", name: "Microsoft Teams" },
    ] },
  ],
  android: [
    { label: "Common browsers", apps: [
      { identifier: "com.android.chrome", name: "Chrome" },
      { identifier: "org.mozilla.firefox", name: "Firefox" },
    ] },
    { label: "Collaboration apps", apps: [
      { identifier: "com.slack", name: "Slack" },
      { identifier: "us.zoom.videomeetings", name: "Zoom" },
      { identifier: "com.microsoft.teams", name: "Microsoft Teams" },
    ] },
  ],
};

const step = ref<"platform" | "source">("platform");
const platform = ref<string | null>(null);
const searchSource = ref("");
const searchQuery = ref("");
const searchResults = ref<Array<{ identifier: string; name: string; iconUrl?: string; source?: string }>>([]);
const isSearching = ref(false);
const searchError = ref<string | null>(null);
const sources = computed(() => (platform.value ? SOURCES_BY_PLATFORM[platform.value] || [] : []));
const manualName = ref("");
const manualIdentifier = ref("");
const catalogError = ref<string | null>(null);
const addedCount = ref(0);

function resetSearchState() {
  searchSource.value = "";
  searchQuery.value = "";
  searchResults.value = [];
  searchError.value = null;
  manualName.value = "";
  manualIdentifier.value = "";
  catalogError.value = null;
  playPackageInput.value = "";
  playLookupResult.value = null;
  playLookupError.value = null;
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    step.value = "platform";
    platform.value = null;
    addedCount.value = 0;
    resetSearchState();
    if (!store.appCatalog.length) store.fetchAppCatalog();
    if (!store.reportedApps.length) store.fetchReportedApps();
  },
);

function choosePlatform(p: string) {
  platform.value = p;
  searchSource.value = SOURCES_BY_PLATFORM[p]?.[0]?.id ?? "";
  step.value = "source";
}

function backToPlatform() {
  step.value = "platform";
  resetSearchState();
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch([searchQuery, searchSource], () => {
  if (searchTimer) clearTimeout(searchTimer);
  if (searchSource.value === "reported_apps" || searchSource.value === "google_play_lookup" || !platform.value) {
    searchResults.value = [];
    searchError.value = null;
    isSearching.value = false;
    return;
  }
  if (searchQuery.value.trim().length < 4 || !searchSource.value) {
    searchResults.value = [];
    searchError.value = null;
    isSearching.value = false;
    return;
  }
  isSearching.value = true;
  searchError.value = null;
  searchTimer = setTimeout(async () => {
    try {
      const res = await store.searchApps(platform.value!, searchQuery.value.trim(), searchSource.value);
      searchResults.value = res.items;
      searchError.value = res.error;
    } catch (err: any) {
      searchResults.value = [];
      searchError.value = err?.response?.data?.detail || err?.message || "Search failed — see server logs";
    } finally {
      isSearching.value = false;
    }
  }, 350);
});

// ── "From Reported Apps" source — local filter, no API call ──
// Matches a catalog entry the same identifier-or-name-insensitive way
// complianceEvaluate.ts's requiredAppList/disallowedAppList matching does —
// used here to flag "already in catalog" so admins aren't tempted to add a
// second, differently-identified entry for an app that's already cataloged
// under a different naming convention.
function findCatalogMatch(plat: string, identifier: string, name?: string | null) {
  const idTarget = identifier.toLowerCase();
  const nameTarget = (name ?? "").toLowerCase();
  return store.appCatalog.find((e) => e.platform === plat && (e.identifier.toLowerCase() === idTarget || (nameTarget && (e.name ?? "").toLowerCase() === nameTarget))) ?? null;
}

const reportedAppsForSource = computed(() => {
  if (!platform.value) return [];
  const q = searchQuery.value.trim().toLowerCase();
  return store.reportedApps
    .filter((a) => a.platform === platform.value)
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.identifier.toLowerCase().includes(q))
    .slice(0, 60);
});

// ── Google Play exact-package lookup (Android only) ──
const playPackageInput = ref("");
const playLookupResult = ref<{ found: boolean; name: string | null } | null>(null);
const isLookingUpPlay = ref(false);
const playLookupError = ref<string | null>(null);

async function lookupPlayPackage() {
  const pkg = playPackageInput.value.trim();
  if (!pkg) return;
  isLookingUpPlay.value = true;
  playLookupError.value = null;
  playLookupResult.value = null;
  try {
    const res = await store.lookupAndroidApp(pkg);
    playLookupError.value = res.error;
    playLookupResult.value = { found: res.found, name: res.name };
  } catch (err: any) {
    playLookupError.value = err?.response?.data?.detail || err?.message || "Lookup failed — see server logs";
  } finally {
    isLookingUpPlay.value = false;
  }
}

async function addByIdentifier(identifier: string, name: string, iconUrl: string | null | undefined, source: string) {
  if (!identifier.trim() || !platform.value) return;
  catalogError.value = null;
  try {
    await store.addAppCatalogEntry({ platform: platform.value, identifier: identifier.trim(), name, iconUrl: iconUrl ?? undefined, source });
    addedCount.value += 1;
  } catch (err: any) {
    catalogError.value = err?.response?.data?.detail || err?.message || `Could not add "${name || identifier}"`;
  }
}

async function addPreset(preset: { apps: Array<{ identifier: string; name: string }> }) {
  catalogError.value = null;
  for (const app of preset.apps) {
    // eslint-disable-next-line no-await-in-loop
    await addByIdentifier(app.identifier, app.name, null, "preset");
  }
}

async function addManualEntry() {
  if (!manualName.value.trim() || !manualIdentifier.value.trim()) return;
  await addByIdentifier(manualIdentifier.value, manualName.value.trim(), null, "manual");
  manualName.value = "";
  manualIdentifier.value = "";
}

async function addToCatalog(item: { identifier: string; name: string; iconUrl?: string }) {
  await addByIdentifier(item.identifier, item.name, item.iconUrl, searchSource.value);
}

async function addPlayLookupResult() {
  if (!playLookupResult.value?.found) return;
  await addByIdentifier(playPackageInput.value.trim(), playLookupResult.value.name || playPackageInput.value.trim(), null, "google_play");
  playPackageInput.value = "";
  playLookupResult.value = null;
}

function close() {
  emit("close");
}
</script>

<template>
  <Modal :open="open" :title="step === 'platform' ? 'Add new Apps' : `Add ${PLATFORM_LABELS[platform!] || platform} apps`" size="lg" class="max-w-2xl" @close="close">
    <!-- Step 1: platform -->
    <div v-if="step === 'platform'" class="space-y-3">
      <p class="text-xs text-gray-400">Which platform are these apps for?</p>
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="p in PLATFORM_CARDS"
          :key="p.value"
          type="button"
          class="flex items-center gap-3 p-4 rounded-xl border text-left transition-colors border-gray-200 dark:border-gray-700 hover:border-brand-400 dark:hover:border-brand-500 bg-white dark:bg-gray-800"
          @click="choosePlatform(p.value)"
        >
          <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
            <component :is="ICONS[p.icon]" :size="18" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ p.label }}</p>
            <p class="text-xs text-gray-400 truncate">{{ p.sub }}</p>
          </div>
        </button>
      </div>
    </div>

    <!-- Step 2: source + search/add -->
    <div v-else class="space-y-3">
      <div class="flex items-center justify-between">
        <button type="button" class="text-[11px] flex items-center gap-1 text-gray-400 hover:opacity-70" @click="backToPlatform">
          <component :is="ICONS.AltArrowLeft" :size="11" weight="Linear" /> Change platform
        </button>
        <p v-if="addedCount > 0" class="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <component :is="ICONS.CheckCircle" :size="11" weight="Linear" /> {{ addedCount }} app{{ addedCount === 1 ? "" : "s" }} added this session
        </p>
      </div>

      <div v-if="sources.length > 1" class="flex gap-1.5 flex-wrap">
        <button
          v-for="s in sources"
          :key="s.id"
          type="button"
          class="text-[10px] px-2.5 py-1 rounded-md font-semibold transition-colors"
          :class="searchSource === s.id ? '' : 'border border-gray-200 dark:border-gray-700 text-gray-400'"
          :style="searchSource === s.id ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : {}"
          @click="searchSource = s.id"
        >
          {{ s.label }}
        </button>
      </div>

      <!-- "From Reported Apps" — local filter over apps SOAR has actually seen installed, no API call -->
      <template v-if="searchSource === 'reported_apps'">
        <Input v-model="searchQuery" placeholder="Filter by name or identifier… (leave blank to see all)" />
        <p v-if="!store.reportedApps.length" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          No apps reported yet — devices report their installed apps via the SOAR Agent or, once a policy references an App List, the background installed-apps refresher. Check back after a device reports, or use another source above.
        </p>
        <div v-else-if="reportedAppsForSource.length === 0" class="text-[10px] text-gray-400">No {{ PLATFORM_LABELS[platform!] || platform }} apps match "{{ searchQuery.trim() }}".</div>
        <div v-else class="space-y-1 max-h-56 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
          <div v-for="a in reportedAppsForSource" :key="`${a.platform}:${a.identifier}`" class="flex items-center justify-between gap-2 text-sm px-1 py-1">
            <span class="truncate flex-1">
              {{ a.name }}
              <span class="text-[9px] text-gray-400">({{ a.identifier }}) · {{ a.deviceCount }} device{{ a.deviceCount === 1 ? "" : "s" }}</span>
            </span>
            <span v-if="findCatalogMatch(a.platform, a.identifier, a.name)" class="text-[10px] text-gray-400 flex items-center gap-1 shrink-0">
              <component :is="ICONS.CheckCircle" :size="11" weight="Linear" /> In catalog
            </span>
            <Button v-else size="sm" variant="ghost" class="shrink-0" @click="addByIdentifier(a.identifier, a.name, null, 'reported_apps')">Add</Button>
          </div>
        </div>
      </template>

      <!-- Google Play exact-package lookup (Android only) -->
      <template v-else-if="searchSource === 'google_play_lookup'">
        <div class="flex items-center gap-2">
          <Input v-model="playPackageInput" placeholder="Exact package name, e.g. com.slack" class="flex-1" @keyup.enter="lookupPlayPackage" />
          <Button size="sm" variant="secondary" :loading="isLookingUpPlay" :disabled="!playPackageInput.trim()" @click="lookupPlayPackage">Look up</Button>
        </div>
        <Alert v-if="playLookupError" type="danger">{{ playLookupError }}</Alert>
        <p v-else-if="playLookupResult && !playLookupResult.found" class="text-[10px] text-gray-400">No app found on Google Play for that exact package name.</p>
        <div v-else-if="playLookupResult?.found" class="flex items-center justify-between gap-2 text-sm px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
          <span class="truncate">{{ playLookupResult.name || playPackageInput.trim() }} <span class="text-[9px] text-gray-400">({{ playPackageInput.trim() }})</span></span>
          <Button size="sm" variant="ghost" @click="addPlayLookupResult">Add</Button>
        </div>
        <p class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          No free-text Play Store search exists for EMMs — this resolves one exact package name against Google Play directly, live, to confirm it exists and fetch its real title.
        </p>
      </template>

      <!-- Applivery-backed API search sources (Apple App Store, MS Store, Winget, Homebrew, Applivery Catalog) -->
      <template v-else>
        <Input v-model="searchQuery" :placeholder="platform === 'android' ? 'App name (already-known Applivery apps only — see note below)' : 'Search apps… (4+ characters)'" />
        <p v-if="isSearching" class="text-[10px] text-gray-400">Searching…</p>
        <Alert v-if="searchError" type="danger">{{ searchError }}</Alert>
        <p v-if="!isSearching && !searchError && searchQuery.trim().length >= 4 && searchResults.length === 0" class="text-[10px] text-gray-400">
          No matches for "{{ searchQuery.trim() }}" on {{ sources.find((s) => s.id === searchSource)?.label || searchSource }}.
        </p>

        <div v-if="searchResults.length" class="space-y-1 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
          <div v-for="r in searchResults" :key="`${r.source}:${r.identifier}`" class="flex items-center justify-between text-sm px-1 py-1">
            <span class="truncate flex-1">{{ r.name }} <span class="text-[9px] text-gray-400">({{ r.identifier }})</span></span>
            <Button size="sm" variant="ghost" @click="addToCatalog(r)">Add</Button>
          </div>
        </div>

        <p v-if="platform === 'android' && searchSource === 'android_known'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          No free-text Play Store search exists for EMMs — results above are apps already known to your Applivery org (App Distribution catalog + Android Enterprise). Try "Google Play (exact package)" or "From Reported Apps" above for anything else.
        </p>
        <p v-if="platform === 'windows' && searchSource === 'winget'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          Winget's community index — a convenience suggestion, not authoritative. Double-check a result before relying on it for enforcement.
        </p>
        <p v-if="platform === 'macos' && searchSource === 'homebrew'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          Homebrew casks have no bundle-ID field — these are name-only suggestions. Confirm the real bundle ID before relying on it.
        </p>
      </template>

      <div v-if="PRESETS[platform!]">
        <label class="block text-[10px] font-medium mb-1 text-gray-400">Quick-start presets</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="preset in PRESETS[platform!]"
            :key="preset.label"
            type="button"
            class="text-[10px] px-2 py-1 rounded-md font-medium"
            :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
            @click="addPreset(preset)"
          >
            + {{ preset.label }}
          </button>
        </div>
      </div>

      <p v-if="catalogError" class="inline-flex items-start gap-1 text-[10px] text-red-500">
        <component :is="ICONS.DangerTriangle" :size="10" weight="Linear" class="shrink-0 mt-0.5" /> {{ catalogError }}
      </p>

      <details class="text-xs">
        <summary class="cursor-pointer font-medium text-gray-500 dark:text-gray-400 select-none">Can't find it? Add manually</summary>
        <div class="flex items-center gap-2 mt-2">
          <Input v-model="manualName" placeholder="App name" class="flex-1" />
          <Input v-model="manualIdentifier" placeholder="Bundle ID / package name" class="flex-1" />
          <Button size="sm" variant="secondary" :disabled="!manualName.trim() || !manualIdentifier.trim()" @click="addManualEntry">Add</Button>
        </div>
      </details>

      <div class="flex justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
        <Button size="sm" @click="close">Done</Button>
      </div>
    </div>
  </Modal>
</template>
