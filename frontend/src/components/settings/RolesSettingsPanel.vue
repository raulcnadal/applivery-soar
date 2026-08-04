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

// isCreatingOrEditing (not just editingRole !== null) because "create new"
// and "no role selected" are both editingRole === null — RolesSettings.jsx
// disambiguates the same way with its `editing` state: null | {} (new) |
// role (edit), we just split that into two refs since TS would otherwise
// need a sentinel object for "new". 1:1 with the original: while this is
// true, the Roles/Collaborators tabs and "New role" button are hidden and
// this swaps in for the whole panel body — never an overlay on top of it.
const isCreatingOrEditing = ref(false);
const editingRole = ref<SoarRole | null>(null);
function openNewRole() { editingRole.value = null; isCreatingOrEditing.value = true; }
function editRole(r: SoarRole) { editingRole.value = r; isCreatingOrEditing.value = true; }
function closeRoleEditor() { isCreatingOrEditing.value = false; editingRole.value = null; }
async function deleteRole(r: SoarRole) {
  if (!confirm(`Delete Role "${r.name}"? Collaborators mapped to it will be denied access until reassigned.`)) return;
  await store.deleteRole(r.id);
}

const editingCollaborator = ref<Collaborator | null>(null);
function editCollaborator(c: Collaborator) { editingCollaborator.value = c; }
function closeCollaboratorEditor() { editingCollaborator.value = null; }

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
    <!-- 1:1 port of RolesSettings.jsx's `if (editing) return <RoleEditor/>`
         (~line 337): Create/Edit Role replaces this entire panel body in
         place — no tabs, no "New role" button, no list underneath — rather
         than opening as an overlay on top of it. -->
    <RoleDialog v-if="isCreatingOrEditing" :role="editingRole" @close="closeRoleEditor" @saved="store.fetchRoles()" />

    <template v-else>
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
        <!-- Same inline-swap pattern as the Roles editor above (see comment
             at the top of the template): editing a collaborator replaces
             the directory table in place instead of opening an overlay. -->
        <CollaboratorEditDialog
          v-if="editingCollaborator"
          :collaborator="editingCollaborator"
          @close="closeCollaboratorEditor"
          @saved="closeCollaboratorEditor(); store.fetchCollaboratorsDirectory()"
        />
        <template v-else>
          <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
          <CollaboratorsDirectoryTable
            :collaborators="store.collaborators"
            :is-loading="store.isLoadingCollaborators"
            @edit="editCollaborator"
            @test-access="runTestAccessFor"
          />
          <div id="test-access-section" class="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p class="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Test access</p>
            <TestAccessPanel ref="testAccessPanelRef" />
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
