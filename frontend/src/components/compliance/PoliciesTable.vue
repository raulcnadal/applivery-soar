<script setup lang="ts">
// Compliance Policies list — enable/disable, evaluate now, edit, delete.
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { ref } from "vue";
import { useComplianceStore, type CompliancePolicy } from "../../stores/compliance";

defineProps<{
  policies: CompliancePolicy[];
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  edit: [policy: CompliancePolicy];
}>();

const store = useComplianceStore();
const runningPolicyId = ref<string | null>(null);
const lastEvalMessage = ref<string | null>(null);

const SEVERITY_COLOR: Record<string, "green" | "yellow" | "orange" | "red"> = {
  low: "green", medium: "yellow", high: "orange", critical: "red",
};

async function toggleEnabled(policy: CompliancePolicy) {
  await store.updatePolicy(policy.id, { ...policy, enabled: !policy.enabled });
}

async function evaluate(policy: CompliancePolicy) {
  runningPolicyId.value = policy.id;
  lastEvalMessage.value = null;
  try {
    const summary = await store.evaluateNow(policy.id);
    lastEvalMessage.value = `"${policy.name}": ${summary.violationsFound} new violation(s) among ${summary.devicesChecked} device(s).`;
  } catch (err: any) {
    lastEvalMessage.value = err?.response?.data?.detail || "Evaluation failed.";
  } finally {
    runningPolicyId.value = null;
  }
}

async function remove(policy: CompliancePolicy) {
  if (!confirm(`Delete policy "${policy.name}"? This cannot be undone.`)) return;
  await store.deletePolicy(policy.id);
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="lastEvalMessage" class="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">{{ lastEvalMessage }}</p>

    <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Policy</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Severity</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Conditions</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">autoRun</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Last evaluated</th>
            <th class="text-left px-4 py-3 font-medium text-gray-500">Status</th>
            <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in policies" :key="p.id" class="border-b border-gray-100 last:border-0">
            <td class="px-4 py-3">
              <p class="font-medium text-gray-900">{{ p.name }}</p>
              <p v-if="p.description" class="text-xs text-gray-400">{{ p.description }}</p>
            </td>
            <td class="px-4 py-3"><StatusPill :label="p.severity" :color="SEVERITY_COLOR[p.severity] ?? 'gray'" /></td>
            <td class="px-4 py-3 text-gray-600">{{ p.conditions.length }} ({{ p.conditionLogic }})</td>
            <td class="px-4 py-3">
              <StatusPill v-if="p.autoRunTripped" label="Tripped" color="red" />
              <StatusPill v-else :label="p.autoRun ? 'On' : 'Off'" :color="p.autoRun ? 'green' : 'gray'" />
            </td>
            <td class="px-4 py-3 text-gray-500">{{ p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleString() : "Never" }}</td>
            <td class="px-4 py-3">
              <button type="button" @click="toggleEnabled(p)">
                <StatusPill :label="p.enabled ? 'Enabled' : 'Disabled'" :color="p.enabled ? 'green' : 'gray'" />
              </button>
            </td>
            <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
              <Button size="sm" variant="ghost" :loading="runningPolicyId === p.id" @click="evaluate(p)">Evaluate now</Button>
              <Button size="sm" variant="secondary" @click="emit('edit', p)">Edit</Button>
              <Button size="sm" variant="ghost" @click="remove(p)">Delete</Button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!isLoading && policies.length === 0" title="No compliance policies yet" description="Create one, or start from the template gallery." />
    </div>
  </div>
</template>
