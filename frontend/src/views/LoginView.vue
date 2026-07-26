<script setup lang="ts">
// Real port of AuthScreen's state machine (ARCHITECTURE.md §1.3):
// credentials -> (optional) mfa -> (optional) workspace -> finishLogin.
import { Alert, Button, Card, Input } from "@applivery/bluesky-vue";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore, type Organization } from "../stores/auth";

type Step = "credentials" | "mfa" | "workspace";

const router = useRouter();
const auth = useAuthStore();

const step = ref<Step>("credentials");
const email = ref("");
const password = ref("");
const twoFactorCode = ref("");
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
  email: string;
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
    const detail = err?.response?.data?.error;
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
    const result = await auth.login({ email: email.value, password: password.value, twoFactorCode: twoFactorCode.value });
    handleLoginResult(result);
  } catch (err: any) {
    error.value = err?.response?.data?.error || "Invalid two-factor code.";
  } finally {
    isLoading.value = false;
  }
}

function handleLoginResult(result: {
  access_token: string;
  appliveryAccessToken: string;
  appliveryRefreshToken: string;
  user: { email: string };
  organizations: Organization[];
  currentOrganizationId?: string;
}) {
  pendingLogin.value = {
    dashboardToken: result.access_token,
    apiToken: result.appliveryAccessToken,
    refreshToken: result.appliveryRefreshToken,
    email: result.user.email,
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
    orgSlug: slug,
    email: pendingLogin.value.email,
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
  <div class="min-h-screen flex items-center justify-center bg-[var(--background)]">
    <Card class="w-full max-w-sm p-8 space-y-4">
      <h1 class="text-lg font-semibold text-brand-900">Applivery SOAR</h1>

      <Alert v-if="error" type="danger">{{ error }}</Alert>

      <form v-if="step === 'credentials'" class="space-y-4" @submit.prevent="submitCredentials">
        <Input v-model="email" label="Email" type="email" placeholder="you@company.com" />
        <Input v-model="password" label="Password" type="password" placeholder="••••••••" />
        <Button class="w-full" type="submit" :loading="isLoading">Sign in</Button>
      </form>

      <form v-else-if="step === 'mfa'" class="space-y-4" @submit.prevent="submitMfa">
        <p class="text-sm text-slate-500">Enter the 6-digit code from your authenticator app.</p>
        <Input v-model="twoFactorCode" label="Two-factor code" placeholder="123456" />
        <Button class="w-full" type="submit" :loading="isLoading">Verify</Button>
      </form>

      <div v-else-if="step === 'workspace'" class="space-y-2">
        <p class="text-sm text-slate-500">Choose a workspace to continue.</p>
        <button
          v-for="org in pendingLogin?.organizations ?? []"
          :key="org._id || org.id || org.slug"
          class="w-full text-left px-4 py-2 rounded-lg border border-gray-200 hover:border-brand-300 hover:bg-brand-50 transition-colors text-sm"
          :disabled="isLoading"
          @click="finishLogin(org)"
        >
          {{ org.name || org.slug || org._id }}
        </button>
      </div>
    </Card>
  </div>
</template>
