<script setup lang="ts">
// "SMTP" tab (docs/settings.md#smtp). No permission gate beyond being
// signed in. `.pass` is encrypted at rest server-side (smtpConfig.ts) — a
// blank password on save means "keep the existing one", same convention
// used by Vulnerability Service's API token field.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref, watch } from "vue";
import { useDashboardStateStore } from "../../stores/dashboardState";
import { useAuthStore } from "../../stores/auth";

const store = useDashboardStateStore();
const auth = useAuthStore();

const form = reactive({ host: "", port: 587, user: "", pass: "", from: "", alertRecipients: "" });
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);

const testRecipient = ref("");
const isTesting = ref(false);
const testError = ref<string | null>(null);
const testOk = ref(false);

onMounted(async () => {
  if (!store.isLoaded) await store.fetchState();
  testRecipient.value = auth.email ?? "";
});

watch(() => store.isLoaded, (loaded) => {
  if (!loaded) return;
  const cfg = store.smtpConfig ?? {};
  form.host = cfg.host ?? "";
  form.port = Number(cfg.port) || 587;
  form.user = cfg.user ?? "";
  form.pass = "";
  form.from = cfg.from ?? "";
  form.alertRecipients = cfg.alertRecipients ?? "";
}, { immediate: true });

function currentSmtpConfig(): Record<string, any> {
  const cfg: Record<string, any> = { host: form.host, port: form.port, user: form.user, from: form.from, alertRecipients: form.alertRecipients };
  if (form.pass) cfg.pass = form.pass;
  return cfg;
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    // A blank password keeps whatever's already stored server-side —
    // merge onto the existing config rather than sending an empty string
    // that would overwrite it.
    const existing = store.smtpConfig ?? {};
    const merged = { ...existing, ...currentSmtpConfig() };
    await store.saveState({ smtpConfig: merged });
    saved.value = true;
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save.";
  } finally {
    isSaving.value = false;
  }
}

async function sendTestEmail() {
  if (!testRecipient.value || !form.host || !form.user) return;
  isTesting.value = true;
  testError.value = null;
  testOk.value = false;
  try {
    const { api } = await import("../../api/http");
    const existing = store.smtpConfig ?? {};
    await api.post("/settings/test-smtp", { smtpConfig: { ...existing, ...currentSmtpConfig() }, testRecipient: testRecipient.value });
    testOk.value = true;
  } catch (err: any) {
    testError.value = err?.response?.data?.detail || "Failed to send test email.";
  } finally {
    isTesting.value = false;
  }
}
</script>

<template>
  <div class="space-y-4 max-w-lg">
    <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
    <Alert v-if="saved" type="success">Saved.</Alert>

    <Input v-model="form.host" label="Host" placeholder="smtp.example.com" />
    <Input v-model.number="form.port" type="number" label="Port" />
    <Input v-model="form.user" label="Username" />
    <Input v-model="form.pass" type="password" label="Password" placeholder="Leave blank to keep the existing password" />
    <Input v-model="form.from" label="From Address" placeholder="reports@yourorg.com" />
    <Input v-model="form.alertRecipients" label="Alert Email Recipients" placeholder="ops@yourorg.com" />
    <p class="text-xs text-gray-400 -mt-3">A separate list from report delivery — used specifically for Case SLA breach and System Health failure/recovery emails.</p>

    <Button :loading="isSaving" @click="save">Save</Button>

    <div class="pt-4 border-t border-gray-100 space-y-2">
      <Alert v-if="testError" type="danger">{{ testError }}</Alert>
      <Alert v-if="testOk" type="success">Test email sent.</Alert>
      <div class="flex items-end gap-2">
        <Input v-model="testRecipient" label="Send Test Email to" class="flex-1" />
        <Button variant="ghost" :loading="isTesting" :disabled="!form.host || !form.user" @click="sendTestEmail">Send Test Email</Button>
      </div>
      <p class="text-xs text-gray-400">Requires Host and Username to be filled in first.</p>
    </div>
  </div>
</template>
