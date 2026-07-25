<script setup lang="ts">
// Connected external Git script repos — browse/import into the library.
// Port of main.py:8700-8872.
import { Button, EmptyState } from "@applivery/bluesky-vue";
import { useScriptReposStore, type ScriptRepo } from "../../stores/scriptRepos";

defineProps<{ repos: ScriptRepo[]; isLoading?: boolean }>();
const emit = defineEmits<{ browse: [repo: ScriptRepo] }>();

const store = useScriptReposStore();

async function remove(repo: ScriptRepo) {
  if (!confirm(`Remove connected repo "${repo.name}"?`)) return;
  await store.deleteRepo(repo.id);
}
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-xl bg-white">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Name</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Repository</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Branch</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Starting path</th>
          <th class="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in repos" :key="r.id" class="border-b border-gray-100 last:border-0">
          <td class="px-4 py-3 font-medium text-gray-900">{{ r.name }}</td>
          <td class="px-4 py-3 text-gray-600">{{ r.owner }}/{{ r.repo }}</td>
          <td class="px-4 py-3 text-gray-500">{{ r.branch }}</td>
          <td class="px-4 py-3 text-gray-500">{{ r.path || "/" }}</td>
          <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap">
            <Button size="sm" variant="secondary" @click="emit('browse', r)">Browse & import</Button>
            <Button size="sm" variant="ghost" @click="remove(r)">Remove</Button>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!isLoading && repos.length === 0" title="No script repos connected" description="Point this at a public GitHub repo of script files (e.g. applivery/applivery-mdm-scripts) to browse and import from it." />
  </div>
</template>
