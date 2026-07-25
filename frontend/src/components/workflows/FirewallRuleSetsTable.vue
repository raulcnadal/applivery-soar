<script setup lang="ts">
// Firewall Policy Library — named, reusable sets of Windows Firewall rules
// referenced from Workflow apply/restore actions. Port of main.py:5025-5486.
import { Button, EmptyState, StatusPill } from "@applivery/bluesky-vue";
import { useFirewallRuleSetsStore, type FirewallRuleSet } from "../../stores/firewallRuleSets";

defineProps<{ ruleSets: FirewallRuleSet[]; isLoading?: boolean }>();
const emit = defineEmits<{ edit: [ruleSet: FirewallRuleSet] }>();

const store = useFirewallRuleSetsStore();

async function remove(ruleSet: FirewallRuleSet) {
  if (!confirm(`Delete firewall rule set "${ruleSet.name}"? Devices already carrying its rules keep them until explicitly restored.`)) return;
  await store.deleteRuleSet(ruleSet.id);
}
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Rules</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Default posture</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Provisioned</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Updated</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in ruleSets" :key="r.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3">
            <p class="font-medium text-gray-900">{{ r.name }}</p>
            <p v-if="r.description" class="text-xs text-gray-400">{{ r.description }}</p>
          </td>
          <td class="px-4 py-3 text-gray-600">{{ r.rules.length }}</td>
          <td class="px-4 py-3 text-gray-500 text-xs">
            In: {{ r.defaultInboundAction }} / Out: {{ r.defaultOutboundAction }}
          </td>
          <td class="px-4 py-3">
            <StatusPill :label="r.applyLibraryId && r.restoreLibraryId ? 'Ready' : 'Incomplete'" :color="r.applyLibraryId && r.restoreLibraryId ? 'green' : 'yellow'" />
          </td>
          <td class="px-4 py-3 text-gray-500">{{ new Date(r.updatedAt).toLocaleString() }}</td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="secondary" @click="emit('edit', r)">Edit</Button>
            <Button size="sm" variant="ghost" @click="remove(r)">Delete</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && ruleSets.length === 0" title="No firewall rule sets yet" description="Compose a named set of Windows Firewall rules — Isolate Device, Block Lateral Movement, etc. — to apply/restore from a workflow action." />
  </div>
</template>
