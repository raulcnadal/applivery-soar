<script setup lang="ts">
// App Catalog manager — extracted from AppListsPanel.vue (previously the
// left column of Compliance > App Lists) into its own component so it can
// live on the new top-level "Apps" view instead, per the user's ask: App
// Lists inside Compliance was getting crowded as more apps get cataloged,
// and app-inventory troubleshooting deserves its own place to grow into
// (more apps features planned later). Compliance > App Lists still reads
// store.appCatalog directly (AppListsPanel.vue's list editor) — this
// component owns *managing* the catalog; anywhere else just references it.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type AppCatalogEntry } from "../../stores/compliance";

const PRIMARY_BLUE = "#0241E3";

const store = useComplianceStore();

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };
const platformOptions = [
  { value: "apple", label: "Apple (iOS/iPadOS)" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];

// Mirrors SEARCH_SOURCES_BY_PLATFORM in appSearch.service.ts, plus two
// sources that aren't Applivery search calls at all and are handled
// entirely client-side (see the searchSource branches in the template):
//  - "reported_apps": apps SOAR has actually seen installed across the
//    fleet (self-reported or Applivery-UEM-fetched — the same data behind
//    the Apps view's "Reported Apps" tab, store.reportedApps). Listed first
//    for every platform since it needs no external lookup and is the
//    highest-trust source there is: it's not "an app that exists somewhere
//    in a store", it's "an app that is demonstrably installed on your
//    devices right now".
//  - "google_play_lookup" (Android only): an exact Google Play package-name
//    lookup, not a search — Applivery's API has no free-text Play Store
//    search for EMMs (confirmed via docs.applivery.com), but does expose an
//    exact-match lookup (android/applications/get-by-name) that resolves a
//    known package id against Google Play live and returns its real title.
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

const searchPlatform = ref("apple");
const searchSource = ref(SOURCES_BY_PLATFORM.apple[0].id);
const searchQuery = ref("");
const searchResults = ref<Array<{ identifier: string; name: string; iconUrl?: string; source?: string }>>([]);
const isSearching = ref(false);
const searchError = ref<string | null>(null);
const sources = computed(() => SOURCES_BY_PLATFORM[searchPlatform.value] || []);
const filterPlatform = ref<string>("");

watch(searchPlatform, (platform) => {
  searchSource.value = (SOURCES_BY_PLATFORM[platform] || [])[0]?.id ?? "";
  searchQuery.value = "";
  searchResults.value = [];
  searchError.value = null;
  playPackageInput.value = "";
  playLookupResult.value = null;
  playLookupError.value = null;
});
watch(searchSource, () => {
  playPackageInput.value = "";
  playLookupResult.value = null;
  playLookupError.value = null;
});

// "reported_apps" and "google_play_lookup" aren't Applivery search calls —
// they're handled entirely below (reportedAppsForSource / the Google Play
// lookup form) — this debounced watcher only drives the remaining
// API-search sources (apple_store, ms_store, winget, homebrew,
// android_known).
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch([searchQuery, searchSource], () => {
  if (searchTimer) clearTimeout(searchTimer);
  if (searchSource.value === "reported_apps" || searchSource.value === "google_play_lookup") {
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
      const res = await store.searchApps(searchPlatform.value, searchQuery.value.trim(), searchSource.value);
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
// complianceEvaluate.ts's requiredAppList/disallowedAppList matching does
// (see that file's doc comment for why: a catalog entry's identifier
// convention and a device's self-reported identifier convention don't
// always agree). Used here to flag "already in catalog" so admins aren't
// tempted to add a second, differently-identified entry for an app that's
// already cataloged under a different naming convention.
function findCatalogMatch(platform: string, identifier: string, name?: string | null) {
  const idTarget = identifier.toLowerCase();
  const nameTarget = (name ?? "").toLowerCase();
  return store.appCatalog.find((e) => e.platform === platform && (e.identifier.toLowerCase() === idTarget || (nameTarget && (e.name ?? "").toLowerCase() === nameTarget))) ?? null;
}

const reportedAppsForSource = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return store.reportedApps
    .filter((a) => a.platform === searchPlatform.value)
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

const manualName = ref("");
const manualIdentifier = ref("");
const catalogError = ref<string | null>(null);

const filteredCatalog = computed(() => (filterPlatform.value ? store.appCatalog.filter((e) => e.platform === filterPlatform.value) : store.appCatalog));

onMounted(async () => {
  await store.fetchAppCatalog();
  // Needed for the "From Reported Apps" source below — ReportedAppsPanel.vue
  // also fetches this, but an admin may open App Catalog without ever
  // visiting Reported Apps first.
  if (!store.reportedApps.length) store.fetchReportedApps();
});

async function addByIdentifier(identifier: string, name: string, iconUrl: string | null | undefined, source: string) {
  if (!identifier.trim()) return;
  catalogError.value = null;
  try {
    await store.addAppCatalogEntry({ platform: searchPlatform.value, identifier: identifier.trim(), name, iconUrl: iconUrl ?? undefined, source });
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

async function removeCatalogEntry(entry: AppCatalogEntry) {
  if (!confirm(`Remove "${entry.name || entry.identifier}" from the App Catalog?`)) return;
  try {
    await store.deleteAppCatalogEntry(entry.id);
  } catch (err: any) {
    alert(err?.response?.data?.detail || "Could not remove — it may still be referenced by an App List.");
  }
}
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <section class="space-y-3">
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Search &amp; add to catalog</p>
      <div class="flex items-center gap-2">
        <Input v-model="searchPlatform" type="select" :options="platformOptions" class="w-40" />
      </div>

      <div v-if="sources.length > 1" class="flex gap-1.5">
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
          No apps reported yet — devices report their installed apps via the SOAR Agent or, once a policy references an App List, the background installed-apps refresher. Check back after a device reports, or use another source below.
        </p>
        <div v-else-if="reportedAppsForSource.length === 0" class="text-[10px] text-gray-400">No {{ PLATFORM_LABELS[searchPlatform] || searchPlatform }} apps match "{{ searchQuery.trim() }}".</div>
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
        <p v-if="catalogError" class="inline-flex items-start gap-1 text-[10px] text-red-500">
          <component :is="ICONS.DangerTriangle" :size="10" weight="Linear" class="shrink-0 mt-0.5" /> {{ catalogError }}
        </p>
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
        <Input v-model="searchQuery" :placeholder="searchPlatform === 'android' ? 'App name (already-known Applivery apps only — see note below)' : 'Search apps… (4+ characters)'" />
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

        <p v-if="searchPlatform === 'android' && searchSource === 'android_known'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          No free-text Play Store search exists for EMMs — results above are apps already known to your Applivery org (App Distribution catalog + Android Enterprise). Try "Google Play (exact package)" or "From Reported Apps" above for anything else.
        </p>
        <p v-if="searchPlatform === 'windows' && searchSource === 'winget'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          Winget's community index — a convenience suggestion, not authoritative. Double-check a result before relying on it for enforcement.
        </p>
        <p v-if="searchPlatform === 'macos' && searchSource === 'homebrew'" class="text-[10px] text-gray-400 flex items-start gap-1">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="shrink-0 mt-0.5" />
          Homebrew casks have no bundle-ID field — these are name-only suggestions. Confirm the real bundle ID before relying on it.
        </p>
      </template>

      <div v-if="PRESETS[searchPlatform]">
        <label class="block text-[10px] font-medium mb-1 text-gray-400">Quick-start presets</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="preset in PRESETS[searchPlatform]"
            :key="preset.label"
            type="button"
            class="text-[10px] px-2 py-1 rounded-md font-medium"
            :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
            @click="addPreset(preset)"
          >
            + {{ preset.label }}
          </button>
        </div>
        <p v-if="catalogError" class="inline-flex items-start gap-1 text-[10px] mt-1.5 text-red-500">
          <component :is="ICONS.DangerTriangle" :size="10" weight="Linear" class="shrink-0 mt-0.5" /> {{ catalogError }}
        </p>
      </div>

      <details class="text-xs">
        <summary class="cursor-pointer font-medium text-gray-500 dark:text-gray-400 select-none">Can't find it? Add manually</summary>
        <div class="flex items-center gap-2 mt-2">
          <Input v-model="manualName" placeholder="App name" class="flex-1" />
          <Input v-model="manualIdentifier" placeholder="Bundle ID / package name" class="flex-1" />
          <Button size="sm" variant="secondary" :disabled="!manualName.trim() || !manualIdentifier.trim()" @click="addManualEntry">Add</Button>
        </div>
      </details>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Catalog ({{ filteredCatalog.length }})</p>
        <select
          v-model="filterPlatform"
          class="px-2 py-1 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All platforms</option>
          <option v-for="p in platformOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>
      <div class="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700 max-h-[420px] overflow-y-auto">
        <div v-for="entry in filteredCatalog" :key="entry.id" class="flex items-center justify-between px-3 py-2 text-sm">
          <div>
            <p class="text-gray-900 dark:text-white">{{ entry.name || entry.identifier }}</p>
            <p class="text-xs text-gray-400">{{ PLATFORM_LABELS[entry.platform] || entry.platform }} · {{ entry.identifier }}</p>
          </div>
          <Button size="sm" variant="ghost" @click="removeCatalogEntry(entry)">Remove</Button>
        </div>
        <p v-if="filteredCatalog.length === 0" class="text-xs text-gray-400 px-3 py-3">No catalog entries yet — search above to add one.</p>
      </div>
    </section>
  </div>
</template>
