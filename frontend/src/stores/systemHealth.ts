import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of GET /api/system-health (main.py:17707-17727). */

export interface SystemHealthJobStatus {
  key: string;
  label: string;
  intervalSeconds: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastDetail: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  consecutiveErrors: number;
  overdue: boolean;
  alertedAt: string | null;
}

export const useSystemHealthStore = defineStore("systemHealth", () => {
  const jobs = ref<SystemHealthJobStatus[]>([]);
  const checkedAt = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchHealth() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/system-health");
      jobs.value = res.data.items ?? [];
      checkedAt.value = res.data.checkedAt ?? null;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load system health.";
    } finally {
      isLoading.value = false;
    }
  }

  return { jobs, checkedAt, isLoading, error, fetchHealth };
});
