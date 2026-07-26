<script setup lang="ts">
// "Test access" dry-run tool (docs/settings.md#roles) — runs the exact same
// access-resolution logic used at real login, on demand, for any email.
import { Alert, Button, Input, StatusPill } from "@applivery/bluesky-vue";
import { ref } from "vue";
import { useRolesStore, type TestAccessResult } from "../../stores/roles";

const props = defineProps<{ prefillEmail?: string | null }>();
const store = useRolesStore();

const email = ref(props.prefillEmail ?? "");
const isRunning = ref(false);
const error = ref<string | null>(null);
const result = ref<TestAccessResult | null>(null);

async function run() {
  if (!email.value) return;
  isRunning.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await store.testAccess(email.value);
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Test access failed.";
  } finally {
    isRunning.value = false;
  }
}

defineExpose({ setEmail: (e: string) => { email.value = e; } });
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs text-gray-400 max-w-2xl">
      Pick a collaborator email and run the exact same access-resolution logic used at real login — surfaces a typo or casing
      mismatch in a mapped tag value immediately instead of it showing up later as a locked-out user.
    </p>
    <div class="flex items-end gap-2 max-w-lg">
      <Input v-model="email" label="Collaborator email" class="flex-1" @keyup.enter="run" />
      <Button :loading="isRunning" :disabled="!email" @click="run">Run test</Button>
    </div>
    <Alert v-if="error" type="danger">{{ error }}</Alert>

    <div v-if="result" class="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
      <div class="flex items-center gap-2">
        <StatusPill
          :label="result.isSuperAdmin ? 'Would allow — Super Admin' : result.allowed ? `Would allow — matched Role “${result.role?.name}” via tag “${result.matchedTagValue}”` : 'Would deny'"
          :color="result.allowed ? 'green' : 'red'"
        />
      </div>
      <p v-if="!result.allowed && result.deniedReason" class="text-sm text-gray-600">{{ result.deniedReason }}</p>
      <p v-if="!result.collaboratorFound" class="text-sm text-amber-600">No matching Applivery collaborator found for this email.</p>

      <div>
        <p class="text-xs font-medium text-gray-500 mb-1">This collaborator's live tag candidates</p>
        <div class="flex flex-wrap gap-1">
          <StatusPill v-for="t in result.liveTagCandidates" :key="t" :label="t" color="brand" />
          <span v-if="!result.liveTagCandidates.length" class="text-gray-400 text-xs">none</span>
        </div>
      </div>

      <div>
        <p class="text-xs font-medium text-gray-500 mb-1">Every tag value mapped across your saved Roles</p>
        <div class="space-y-1">
          <div v-for="r in result.roleTagValuesChecked" :key="r.roleId" class="text-xs text-gray-600 flex items-center gap-2">
            <span class="font-medium">{{ r.roleName }}:</span>
            <span v-if="r.tagValues.length">{{ r.tagValues.join(", ") }}</span>
            <span v-else class="text-gray-400">no tags mapped</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
