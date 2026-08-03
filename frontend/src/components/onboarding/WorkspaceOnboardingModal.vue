<script setup lang="ts">
// New-workspace onboarding — port of WorkspaceOnboardingModal.jsx. Offered
// once per still-empty workspace per browser (checked via GET
// /api/config/workspace-status right after login/switch — see AppShell.vue)
// — dismissing it (either "Start from scratch" or the X) sets a
// per-workspace localStorage flag so it doesn't nag again while the admin
// is still configuring things by hand.
import { Alert, Button } from "@applivery/bluesky-vue";
import { computed, reactive, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { CONFIG_STORE_LABELS, useWorkspaceConfigStore } from "../../stores/workspaceConfig";

const props = defineProps<{ canCopyConfig?: boolean }>();
const emit = defineEmits<{ close: []; cloned: [] }>();

const auth = useAuthStore();
const configStore = useWorkspaceConfigStore();

const mode = ref<"choice" | "copy">("choice");
const sourceSlug = ref("");
const isCloning = ref(false);
const error = ref<string | null>(null);

// Stores an admin almost always wants copied onto a new workspace — org
// standards with no per-workspace secret embedded in them. Everything else
// (integrations, threat intel providers, the Applivery webhook config)
// typically carries a workspace-specific secret/endpoint that would
// silently misroute alerts into the wrong workspace if cloned by default.
// Pre-ticked, never auto-submitted — the admin still reviews and confirms.
const DEFAULT_CHECKED_STORES = new Set([
  "compliancePolicies", "workflows", "triggers", "caseAutoRunRules", "caseSlaSettings",
  "actionLibrary", "appLists", "scriptRepos", "dashboardState",
]);
const selected = reactive<Record<string, boolean>>(
  Object.fromEntries(Object.keys(CONFIG_STORE_LABELS).map((k) => [k, DEFAULT_CHECKED_STORES.has(k)])),
);

const siblings = computed(() =>
  props.canCopyConfig !== false ? auth.organizations.filter((o) => (o.slug ?? o._id ?? o.id) !== auth.orgSlug) : [],
);

function dismissForThisWorkspace() {
  try {
    localStorage.setItem(`applivery_onboarding_dismissed_${auth.orgSlug}`, "1");
  } catch {
    /* ignore */
  }
}

function startFromScratch() {
  dismissForThisWorkspace();
  emit("close");
}

async function clone() {
  const stores = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  if (!sourceSlug.value) {
    error.value = "Pick a workspace to copy from.";
    return;
  }
  if (stores.length === 0) {
    error.value = "Select at least one item to copy.";
    return;
  }
  isCloning.value = true;
  error.value = null;
  try {
    await configStore.cloneFrom(sourceSlug.value, stores);
    dismissForThisWorkspace();
    emit("cloned");
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to copy configuration.";
  } finally {
    isCloning.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[280] flex items-center justify-center bg-black/60 p-4">
    <div class="w-full max-w-lg rounded-2xl shadow-xl overflow-hidden flex flex-col bg-white dark:bg-gray-800" style="max-height: 88vh">
      <div class="flex items-center justify-between px-5 py-4 shrink-0 border-b border-gray-100 dark:border-gray-800">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Set up this workspace</h3>
        <button type="button" class="p-1 rounded-lg hover:opacity-70 text-gray-500 dark:text-gray-400" @click="startFromScratch">✕</button>
      </div>

      <div class="overflow-y-auto flex-1 px-5 py-4">
        <p class="text-xs mb-4 text-gray-500 dark:text-gray-400">
          This workspace doesn't have any Compliance Policies, Workflows, or other configuration yet.
          <template v-if="siblings.length > 0">
            You have access to other workspaces in this account — want to start from one of them instead of from scratch?
          </template>
        </p>

        <Alert v-if="error" type="danger">{{ error }}</Alert>

        <div v-if="mode === 'choice'" class="space-y-2">
          <button
            v-if="siblings.length > 0"
            type="button"
            class="w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-left transition-all hover:border-brand-500"
            @click="mode = 'copy'"
          >
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Copy configuration from another workspace</p>
              <p class="text-xs mt-0.5 text-gray-500 dark:text-gray-400">Bring over Compliance Policies, Workflows, and other settings from a workspace you already have set up.</p>
            </div>
          </button>
          <button
            type="button"
            class="w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-left transition-all hover:border-brand-500"
            @click="startFromScratch"
          >
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Start from scratch</p>
              <p class="text-xs mt-0.5 text-gray-500 dark:text-gray-400">Configure this workspace's policies and workflows yourself. You can still copy from another workspace later from Settings &gt; Backup &amp; Restore.</p>
            </div>
          </button>
        </div>

        <div v-else class="space-y-4">
          <div>
            <label class="block text-xs font-semibold mb-1.5 text-gray-900 dark:text-white">Copy from</label>
            <select v-model="sourceSlug" class="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700 outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Select a workspace…</option>
              <option v-for="org in siblings" :key="org.id || org._id || org.slug" :value="org.slug">{{ org.name || org.slug }} ({{ org.slug }})</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold mb-1.5 text-gray-900 dark:text-white">What to copy</label>
            <div class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              <label v-for="(label, key) in CONFIG_STORE_LABELS" :key="key" class="flex items-center gap-2 text-xs cursor-pointer text-gray-900 dark:text-white">
                <input type="checkbox" v-model="selected[key]" />
                {{ label }}
              </label>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <Button variant="ghost" size="sm" @click="mode = 'choice'">Back</Button>
            <Button class="flex-1" :loading="isCloning" @click="clone">Copy configuration</Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
