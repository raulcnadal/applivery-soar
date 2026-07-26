<script setup lang="ts">
// "Roles" Settings section — Super-Admin-only, two sub-views (docs/settings.md#roles):
// Roles (CRUD) and Collaborators & Tags (directory + edit + Test access).
import { Alert, Button, Tabs } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import RolesTable from "./RolesTable.vue";
import RoleDialog from "./RoleDialog.vue";
import CollaboratorsDirectoryTable from "./CollaboratorsDirectoryTable.vue";
import CollaboratorEditDialog from "./CollaboratorEditDialog.vue";
import TestAccessPanel from "./TestAccessPanel.vue";
import { useRolesStore, type Collaborator, type SoarRole } from "../../stores/roles";

const store = useRolesStore();

const subTabs = [
  { id: "roles", label: "Roles" },
  { id: "collaborators", label: "Collaborators & Tags" },
];
const activeSubTab = ref("roles");

const roleDialogOpen = ref(false);
const editingRole = ref<SoarRole | null>(null);
function openNewRole() { editingRole.value = null; roleDialogOpen.value = true; }
function editRole(r: SoarRole) { editingRole.value = r; roleDialogOpen.value = true; }
async function deleteRole(r: SoarRole) {
  if (!confirm(`Delete Role "${r.name}"? Collaborators mapped to it will be denied access until reassigned.`)) return;
  await store.deleteRole(r.id);
}

const collabDialogOpen = ref(false);
const editingCollaborator = ref<Collaborator | null>(null);
function editCollaborator(c: Collaborator) { editingCollaborator.value = c; collabDialogOpen.value = true; }

const testAccessPanelRef = ref<InstanceType<typeof TestAccessPanel> | null>(null);
function runTestAccessFor(c: Collaborator) {
  const email = String(c.email ?? (c as any).user?.email ?? "");
  testAccessPanelRef.value?.setEmail(email);
  const el = document.getElementById("test-access-section");
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

onMounted(async () => {
  await store.fetchRoles();
});

async function onSubTabChange(tabId: string) {
  activeSubTab.value = tabId;
  if (tabId === "collaborators" && store.collaborators.length === 0) await store.fetchCollaboratorsDirectory();
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <Tabs :tabs="subTabs" :model-value="activeSubTab" variant="pill" @update:model-value="onSubTabChange($event as string)" />
      <Button v-if="activeSubTab === 'roles'" @click="openNewRole">New role</Button>
    </div>

    <template v-if="activeSubTab === 'roles'">
      <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
      <p class="text-xs text-gray-400 max-w-2xl">
        The Applivery workspace Owner is always Super Admin with full access, unconditionally — the only automatic bypass.
        Every other collaborator needs a Role whose tag values match one of their live Applivery tags, or they're denied
        outright; there is no default/fallback access level.
      </p>
      <RolesTable :roles="store.roles" :is-loading="store.isLoading" @edit="editRole" @delete="deleteRole" />
    </template>

    <template v-else>
      <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
      <CollaboratorsDirectoryTable
        :collaborators="store.collaborators"
        :is-loading="store.isLoadingCollaborators"
        @edit="editCollaborator"
        @test-access="runTestAccessFor"
      />
      <div id="test-access-section" class="border-t border-gray-200 pt-4">
        <p class="text-sm font-medium text-gray-700 mb-2">Test access</p>
        <TestAccessPanel ref="testAccessPanelRef" />
      </div>
    </template>

    <RoleDialog :open="roleDialogOpen" :role="editingRole" @close="roleDialogOpen = false" @saved="store.fetchRoles()" />
    <CollaboratorEditDialog
      :open="collabDialogOpen"
      :collaborator="editingCollaborator"
      @close="collabDialogOpen = false"
      @saved="store.fetchCollaboratorsDirectory()"
    />
  </div>
</template>
