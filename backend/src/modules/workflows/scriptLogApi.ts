import { appliveryClient } from "../../services/appliveryClient";

/**
 * Port of `_fetch_script_log_summary_entry`/`_fetch_script_log_detail`
 * (main.py:8910-8942) — Applivery's per-device "script logs" resource
 * (confirmed via Applivery's OpenAPI schema): one row per script Asset ever
 * run on a device, with rolling {success, error} counts and the timestamp of
 * its last run. Used both by executeRunScript (baseline snapshot at dispatch
 * time) and scriptLogReconciler (polling until the counts move past that
 * baseline). Always best-effort — a failure here is "no new information",
 * never surfaced as an error, since these are called opportunistically.
 */

export interface ScriptLogSummaryEntry {
  id?: string;
  mdmAsset?: { id?: string };
  status?: { success?: number; error?: number };
  lastDate?: string;
  [key: string]: unknown;
}

export async function fetchScriptLogSummaryEntry(
  headers: Record<string, string>,
  orgBase: string,
  platformPath: string,
  platformDeviceId: string,
  assetId: string,
): Promise<ScriptLogSummaryEntry | null> {
  try {
    const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${platformDeviceId}/script-logs/summary`;
    const res = await appliveryClient.get(url, { headers });
    if (res.status >= 300) return null;
    const items = ((res.data as any)?.data as ScriptLogSummaryEntry[]) ?? [];
    for (const item of items) {
      if (item && typeof item === "object" && item.mdmAsset?.id === assetId) return item;
    }
    return null;
  } catch (e) {
    console.warn(`[script-log-summary] fetch failed: ${e}`);
    return null;
  }
}

export async function fetchScriptLogDetail(
  headers: Record<string, string>,
  orgBase: string,
  platformPath: string,
  platformDeviceId: string,
  logId: string | undefined | null,
): Promise<Record<string, unknown> | null> {
  if (!logId) return null;
  try {
    const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${platformDeviceId}/script-logs/${logId}`;
    const res = await appliveryClient.get(url, { headers });
    if (res.status >= 300) return null;
    return ((res.data as any)?.data as Record<string, unknown>) ?? null;
  } catch (e) {
    console.warn(`[script-log-detail] fetch failed: ${e}`);
    return null;
  }
}
