import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of GET /api/audit-logs, /actors, /export (main.py:2530-2591). */

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  severity: string;
  actor: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  message: string;
}

export interface AuditLogFilters {
  q?: string;
  category?: string;
  severity?: string;
  date_from?: string;
  date_to?: string;
  target_id?: string;
  actor?: string;
}

export const useAuditLogsStore = defineStore("auditLogs", () => {
  const items = ref<AuditLogEntry[]>([]);
  const total = ref(0);
  const retentionDays = ref(90);
  const actors = ref<string[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const PAGE_SIZE = 50;
  const offset = ref(0);

  async function fetchLogs(filters: AuditLogFilters = {}, reset = true) {
    isLoading.value = true;
    error.value = null;
    if (reset) offset.value = 0;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/audit-logs", { params: { ...filters, limit: PAGE_SIZE, offset: offset.value } });
      items.value = res.data.items ?? [];
      total.value = res.data.total ?? 0;
      retentionDays.value = res.data.retentionDays ?? 90;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load audit logs.";
    } finally {
      isLoading.value = false;
    }
  }

  async function nextPage(filters: AuditLogFilters) {
    if (offset.value + PAGE_SIZE >= total.value) return;
    offset.value += PAGE_SIZE;
    await fetchLogs(filters, false);
  }

  async function prevPage(filters: AuditLogFilters) {
    offset.value = Math.max(0, offset.value - PAGE_SIZE);
    await fetchLogs(filters, false);
  }

  async function fetchActors() {
    const { api } = await import("../api/http");
    const res = await api.get("/audit-logs/actors");
    actors.value = res.data.items ?? [];
  }

  async function exportCsv(filters: AuditLogFilters = {}) {
    const { api } = await import("../api/http");
    const res = await api.get("/audit-logs/export", { params: filters, responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return { items, total, retentionDays, actors, isLoading, error, offset, PAGE_SIZE, fetchLogs, nextPage, prevPage, fetchActors, exportCsv };
});
