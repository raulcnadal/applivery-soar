<script setup lang="ts">
// Cases top-level view. Port of the original app's Cases queue
// (migration-plan.md Phase 5 checkpoint: "Case lifecycle end-to-end").
import { Alert, Button, PageHeader } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import CasesTable from "../components/cases/CasesTable.vue";
import CaseCreateDialog from "../components/cases/CaseCreateDialog.vue";
import CaseDetailDrawer from "../components/cases/CaseDetailDrawer.vue";
import { useCasesStore, type Case } from "../stores/cases";

const store = useCasesStore();

const createOpen = ref(false);
const detailOpen = ref(false);
const activeCaseId = ref<string | null>(null);

function openCase(c: Case) {
  activeCaseId.value = c.id;
  detailOpen.value = true;
}

async function bulkUpdate(caseIds: string[], payload: { status?: string | null; assignee?: string | null }) {
  await store.bulkUpdateCases(caseIds, payload);
}

onMounted(async () => {
  await store.fetchCases();
});
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Cases" :description="`${store.cases.length} case${store.cases.length === 1 ? '' : 's'}`">
      <template #action>
        <a :href="store.exportCasesUrl()" target="_blank" rel="noopener" class="mr-2 inline-block">
          <Button variant="ghost">Export CSV</Button>
        </a>
        <Button @click="createOpen = true">New case</Button>
      </template>
    </PageHeader>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <CasesTable :cases="store.cases" :is-loading="store.isLoading" @open="openCase" @bulk-update="bulkUpdate" />

    <CaseCreateDialog :open="createOpen" @close="createOpen = false" @created="store.fetchCases()" />
    <CaseDetailDrawer :open="detailOpen" :case-id="activeCaseId" @close="detailOpen = false" @changed="store.fetchCases()" />
  </div>
</template>
