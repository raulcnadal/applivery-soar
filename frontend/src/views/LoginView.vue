<script setup lang="ts">
// Real port of AuthScreen's state machine (ARCHITECTURE.md §1.3):
// credentials -> (optional) mfa -> (optional) workspace -> finishLogin.
import { Alert } from "@applivery/bluesky-vue";
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore, type Organization } from "../stores/auth";
import { useUiStore } from "../stores/ui";

// Port of AuthScreen's own local themeMode read (App.jsx:6472-6475) — the
// login screen is themed too, even pre-auth, from whatever's already in
// localStorage (the same value useUiStore() reads at module-load time).
const uiStore = useUiStore();

type Step = "credentials" | "mfa" | "workspace";
// 1:1 port of AuthScreen's MFA digit boxes (App.jsx ~6480-6520): six
// single-character inputs instead of one text field, with auto-advance,
// backspace-to-previous, arrow-key navigation, and paste-splits-across-boxes.
const digits = ref(["", "", "", "", "", ""]);
const digitRefs = ref<Array<HTMLInputElement | null>>([]);
const mfaCode = computed(() => digits.value.join(""));

function handleDigitInput(index: number, e: Event) {
  const value = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(-1);
  digits.value[index] = value;
  if (value && index < 5) digitRefs.value[index + 1]?.focus();
}
function handleDigitKeydown(index: number, e: KeyboardEvent) {
  if (e.key === "Backspace" && !digits.value[index] && index > 0) digitRefs.value[index - 1]?.focus();
  if (e.key === "ArrowLeft" && index > 0) digitRefs.value[index - 1]?.focus();
  if (e.key === "ArrowRight" && index < 5) digitRefs.value[index + 1]?.focus();
}
function handleDigitPaste(e: ClipboardEvent) {
  e.preventDefault();
  const pasted = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "").slice(0, 6);
  const next = ["", "", "", "", "", ""];
  pasted.split("").forEach((ch, i) => {
    if (i < 6) next[i] = ch;
  });
  digits.value = next;
  digitRefs.value[Math.min(pasted.length, 5)]?.focus();
}

const router = useRouter();
const auth = useAuthStore();

const step = ref<Step>("credentials");
const email = ref("");
const password = ref("");
const isLoading = ref(false);
const error = ref<string | null>(null);

// Held in memory only between login and finishLogin — never persisted,
// same reasoning as the original (StatePayload's comment: a personal
// session token must never land in shared/disk state). A ref (not a plain
// let) so the workspace-picker step in the template stays reactive.
interface PendingLogin {
  dashboardToken: string;
  apiToken: string;
  refreshToken: string;
  apiTokenExpireAt?: string;
  refreshTokenExpireAt?: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  organizations: Organization[];
  currentOrganizationId?: string;
}
const pendingLogin = ref<PendingLogin | null>(null);

async function submitCredentials() {
  error.value = null;
  isLoading.value = true;
  try {
    const result = await auth.login({ email: email.value, password: password.value });
    handleLoginResult(result);
  } catch (err: any) {
    // Backend errors are wrapped as { detail: { error: "..." } } (see
    // errorHandler.middleware.ts), matching the original FastAPI app's
    // HTTPException(detail=...) envelope — NOT { error: "..." } at the top
    // level. Reading err.response.data.error directly (as this used to)
    // always came back undefined, so the TWO_FACTOR_REQUIRED sentinel from
    // Applivery's error code 4014 never matched and MFA-enabled accounts
    // just saw a generic "Invalid email or password." instead of the MFA
    // step — see main.py:940-941 / App.jsx:6549 for the original behavior.
    const detail = err?.response?.data?.detail?.error;
    if (detail === "TWO_FACTOR_REQUIRED") {
      step.value = "mfa";
    } else {
      error.value = detail || "Invalid email or password.";
    }
  } finally {
    isLoading.value = false;
  }
}

async function submitMfa() {
  error.value = null;
  isLoading.value = true;
  try {
    const result = await auth.login({ email: email.value, password: password.value, twoFactorCode: mfaCode.value });
    handleLoginResult(result);
  } catch (err: any) {
    error.value = err?.response?.data?.detail?.error || "Invalid two-factor code.";
  } finally {
    isLoading.value = false;
  }
}

function backToCredentials() {
  step.value = "credentials";
  digits.value = ["", "", "", "", "", ""];
  error.value = null;
  nextTick(() => digitRefs.value[0]?.focus());
}

function handleLoginResult(result: {
  access_token: string;
  appliveryAccessToken: string;
  appliveryAccessTokenExpireAt?: string;
  appliveryRefreshToken: string;
  appliveryRefreshTokenExpireAt?: string;
  user: { email: string; fullName?: string; picture?: string };
  organizations: Organization[];
  currentOrganizationId?: string;
}) {
  pendingLogin.value = {
    dashboardToken: result.access_token,
    apiToken: result.appliveryAccessToken,
    refreshToken: result.appliveryRefreshToken,
    apiTokenExpireAt: result.appliveryAccessTokenExpireAt,
    refreshTokenExpireAt: result.appliveryRefreshTokenExpireAt,
    email: result.user.email,
    fullName: result.user.fullName,
    avatarUrl: result.user.picture,
    organizations: result.organizations,
    currentOrganizationId: result.currentOrganizationId,
  };

  if (result.organizations.length > 1) {
    step.value = "workspace";
  } else if (result.organizations.length === 1) {
    finishLogin(result.organizations[0]);
  } else {
    error.value = "This account has no organizations to sign into.";
  }
}

async function finishLogin(org: Organization) {
  if (!pendingLogin.value) return;
  const slug = org.slug || org._id || org.id || "";
  auth.persistSession({
    dashboardToken: pendingLogin.value.dashboardToken,
    apiToken: pendingLogin.value.apiToken,
    refreshToken: pendingLogin.value.refreshToken,
    apiTokenExpireAt: pendingLogin.value.apiTokenExpireAt,
    refreshTokenExpireAt: pendingLogin.value.refreshTokenExpireAt,
    orgSlug: slug,
    email: pendingLogin.value.email,
    fullName: pendingLogin.value.fullName,
    avatarUrl: pendingLogin.value.avatarUrl,
    organizations: pendingLogin.value.organizations,
  });
  isLoading.value = true;
  try {
    await auth.resolveAccess();
    router.push({ name: "overview" });
  } catch {
    error.value = "Signed in, but couldn't resolve your workspace access. Try again.";
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <!-- 1:1 port of AuthScreen (App.jsx ~6470-6660): full-bleed Applivery
       background image, centered card with the login mark (inverted for
       light mode), and a 3-step flow (credentials -> mfa -> workspace). -->
  <div
    class="min-h-screen flex flex-col items-center justify-center p-4"
    :style="{ backgroundColor: uiStore.activeTheme.bg, backgroundImage: `url('https://dashboard.applivery.io/images/loading-bg.svg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }"
  >
    <div class="p-10 rounded-2xl border max-w-md w-full min-h-[450px] flex flex-col justify-center shadow-2xl relative overflow-hidden" :style="{ backgroundColor: uiStore.activeTheme.card, borderColor: uiStore.activeTheme.border }">
      <img src="/applivery-bp-login.svg" class="h-8 mx-auto mb-8" alt="Applivery" :style="{ filter: uiStore.isDark ? 'none' : 'invert(1)' }" />

      <form v-if="step === 'credentials'" @submit.prevent="submitCredentials">
        <h1 class="text-xl font-normal mb-6 text-center text-gray-900 dark:text-white">Welcome Back</h1>

        <div v-if="error" class="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-500 text-xs font-medium text-center">{{ error }}</div>

        <div class="mb-4">
          <label class="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Email</label>
          <input
            v-model="email"
            type="email"
            required
            autofocus
            placeholder="you@company.com"
            class="w-full rounded-lg px-3 py-3 outline-none text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div class="mb-6">
          <label class="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Password</label>
          <input
            v-model="password"
            type="password"
            required
            placeholder="••••••••"
            class="w-full rounded-lg px-3 py-3 outline-none text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          type="submit"
          :disabled="isLoading || !email || !password"
          class="w-full text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
          style="background-color: #0055ff"
        >
          <span v-if="isLoading" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          {{ isLoading ? "Signing in…" : "Sign in" }}
        </button>
      </form>

      <div v-else-if="step === 'mfa'">
        <button type="button" class="absolute top-6 left-6 text-gray-500 dark:text-gray-400 hover:opacity-70 transition-opacity" @click="backToCredentials">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h1 class="text-xl font-bold mb-1 text-center text-gray-900 dark:text-white">Two-Factor authentication</h1>
        <p class="text-sm mb-6 text-center text-gray-500 dark:text-gray-400">Enter the six-digit code generated by your Authenticator App.</p>

        <div v-if="error" class="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-500 text-xs font-medium text-center">{{ error }}</div>

        <form @submit.prevent="submitMfa">
          <div class="mb-6">
            <div class="flex gap-2" @paste="handleDigitPaste">
              <input
                v-for="(digit, i) in digits"
                :key="i"
                :ref="(el) => (digitRefs[i] = el as HTMLInputElement)"
                type="text"
                inputmode="numeric"
                maxlength="1"
                :value="digit"
                :autofocus="i === 0"
                class="flex-1 min-w-0 aspect-square rounded-xl text-center text-xl font-semibold border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-brand-500"
                @input="handleDigitInput(i, $event)"
                @keydown="handleDigitKeydown(i, $event)"
              />
            </div>
          </div>

          <button
            type="submit"
            :disabled="isLoading || mfaCode.length !== 6"
            class="w-full text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            style="background-color: #0055ff"
          >
            <span v-if="isLoading" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {{ isLoading ? "Verifying…" : "Sign in" }}
          </button>
        </form>
      </div>

      <div v-else-if="step === 'workspace'">
        <h1 class="text-xl font-bold mb-1 text-center text-gray-900 dark:text-white">Select Workspace</h1>
        <p class="text-sm mb-6 text-center text-gray-500 dark:text-gray-400">Your account has access to multiple workspaces. Choose one to continue.</p>
        <Alert v-if="error" type="danger" class="mb-4">{{ error }}</Alert>
        <div class="space-y-2 max-h-72 overflow-y-auto">
          <button
            v-for="org in pendingLogin?.organizations ?? []"
            :key="org._id || org.id || org.slug"
            type="button"
            :disabled="isLoading"
            class="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-brand-500 transition-colors text-sm font-medium text-gray-900 dark:text-white"
            @click="finishLogin(org)"
          >
            {{ org.name || org.slug || org._id }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
