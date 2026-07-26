import { defineStore } from "pinia";
import { ref } from "vue";
import type { FeatureArea, FeatureLevel, RiskyAction } from "./auth";

/**
 * Port of the Roles / Collaborators / Test Access section of Settings
 * (docs/settings.md#roles, main.py:1293-1467) — Super-Admin-only. Backend
 * routes live in roles.controller.ts (all 7, gated `superAdminOnly`).
 */
export interface SoarRole {
  id: string;
  name: string;
  description?: string | null;
  featureAccess: Partial<Record<FeatureArea, FeatureLevel>>;
  riskyActions: Partial<Record<RiskyAction, boolean>>;
  appliveryTagValues: string[];
  segmentIds: string[];
}

export interface RolePayload {
  name: string;
  description?: string;
  featureAccess: Partial<Record<FeatureArea, FeatureLevel>>;
  riskyActions: Partial<Record<RiskyAction, boolean>>;
  appliveryTagValues: string[];
  segmentIds: string[];
}

export interface Collaborator {
  id?: string;
  _id?: string;
  email?: string;
  name?: string;
  role?: string;
  role_normalized?: string;
  tagCandidates?: string[];
  [key: string]: unknown;
}

export interface TestAccessResult {
  allowed: boolean;
  isSuperAdmin: boolean;
  role: SoarRole | null;
  collaboratorRole: string | null;
  matchedTagValue: string | null;
  deniedReason: string | null;
  collaboratorFound: boolean;
  liveTagCandidates: string[];
  roleTagValuesChecked: Array<{ roleId: string; roleName: string; tagValues: string[] }>;
}

export const useRolesStore = defineStore("roles", () => {
  const roles = ref<SoarRole[]>([]);
  const featureAreas = ref<FeatureArea[]>([]);
  const riskyActionKeys = ref<RiskyAction[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const collaborators = ref<Collaborator[]>([]);
  const collaboratorSegments = ref<Array<Record<string, any>>>([]);
  const availableTags = ref<string[]>([]);
  const isLoadingCollaborators = ref(false);

  async function fetchRoles() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/roles");
      roles.value = res.data.items ?? [];
      featureAreas.value = res.data.featureAreas ?? [];
      riskyActionKeys.value = res.data.riskyActions ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load roles.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createRole(payload: RolePayload) {
    const { api } = await import("../api/http");
    await api.post("/roles", payload);
    await fetchRoles();
  }

  async function updateRole(roleId: string, payload: RolePayload) {
    const { api } = await import("../api/http");
    await api.put(`/roles/${roleId}`, payload);
    await fetchRoles();
  }

  async function deleteRole(roleId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/roles/${roleId}`);
    await fetchRoles();
  }

  async function fetchCollaboratorsDirectory() {
    isLoadingCollaborators.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/roles/collaborators-directory");
      collaborators.value = res.data.collaborators ?? [];
      collaboratorSegments.value = res.data.segments ?? [];
      availableTags.value = res.data.availableTags ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load collaborators.";
    } finally {
      isLoadingCollaborators.value = false;
    }
  }

  async function updateCollaboratorTags(collaboratorId: string, payload: { role?: string; tags: string[] }) {
    const { api } = await import("../api/http");
    await api.put(`/roles/collaborators/${collaboratorId}`, payload);
    await fetchCollaboratorsDirectory();
  }

  async function testAccess(email: string): Promise<TestAccessResult> {
    const { api } = await import("../api/http");
    const res = await api.post("/roles/test-access", { email });
    return res.data;
  }

  return {
    roles, featureAreas, riskyActionKeys, isLoading, error,
    collaborators, collaboratorSegments, availableTags, isLoadingCollaborators,
    fetchRoles, createRole, updateRole, deleteRole,
    fetchCollaboratorsDirectory, updateCollaboratorTags, testAccess,
  };
});
