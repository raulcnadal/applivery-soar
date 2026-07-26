import { prisma } from "../../services/prisma";
import { sendAlertEmail } from "../../services/alertEmail";
import { SYSTEM_HEALTH_JOBS } from "./systemHealth.registry";

/**
 * System Health — port of main.py:17662-17822 (`_system_health_job_overdue`,
 * `get_system_health`, `_fire_system_health_alert`,
 * `_check_system_health_and_alert`). Global, not per-workspace (every
 * scheduler loop already iterates every workspace internally per tick, so
 * "did the loop run" is one process-wide fact) — same as the original's
 * SYSTEM_HEALTH_FILE.
 */

function isOverdue(intervalSeconds: number, lastHeartbeatAt: Date | null): boolean {
  if (!lastHeartbeatAt) return true;
  const thresholdMs = Math.max(intervalSeconds * 3, 300) * 1000;
  return Date.now() - lastHeartbeatAt.getTime() > thresholdMs;
}

export async function getSystemHealth() {
  const rows = await prisma.systemHealthJob.findMany();
  const byKey = new Map(rows.map((r) => [r.jobKey, r]));
  const now = new Date();
  const jobs = SYSTEM_HEALTH_JOBS.map((meta) => {
    const entry = byKey.get(meta.key);
    return {
      key: meta.key,
      label: meta.label,
      intervalSeconds: meta.intervalSeconds,
      lastRunAt: entry?.lastHeartbeatAt?.toISOString() ?? null,
      lastStatus: entry?.status ?? null,
      lastDetail: entry?.detail ?? null,
      lastSuccessAt: entry?.lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: entry?.lastErrorAt?.toISOString() ?? null,
      consecutiveErrors: entry?.consecutiveErrors ?? 0,
      overdue: isOverdue(meta.intervalSeconds, entry?.lastHeartbeatAt ?? null),
      alertedAt: entry?.lastAlertSentAt?.toISOString() ?? null,
    };
  });
  return { items: jobs, checkedAt: now.toISOString() };
}

/**
 * Fires a one-time chat/webhook/paging + email alert the moment a job first
 * becomes unhealthy, then a one-time recovery notice once it's healthy
 * again — port of `_fire_system_health_alert` (main.py:17729). Reuses the
 * chat/webhook/paging senders integrations already have by shaping the
 * alert as a minimal case-like object, same trick `testIntegration` uses.
 */
async function fireSystemHealthAlert(jobKey: string, label: string, action: "trigger" | "resolve", detail: string): Promise<void> {
  const { sendChatNotification, sendGenericWebhook, sendPagingEvent, decryptIntegrationConfigForDispatch } = await import("../integrations/integrations.service");
  const alertCase = {
    id: `system_health:${jobKey}`,
    title: `[System Health] ${label}`,
    severity: action === "trigger" ? "critical" : "low",
    status: action === "trigger" ? "open" : "closed",
    source: "system_health",
    deviceName: null,
    policyName: null,
    externalRefs: [],
  };
  const eventType = action === "trigger" ? "created" : "closed";

  // "global" bucket — system health itself is global, not per-workspace,
  // same as the original's use of _GLOBAL_STORE_SLUG here.
  const integrations = await prisma.integration.findMany({ where: { workspaceSlug: "global", notifyOnSystemHealth: true, enabled: true } });
  for (const integ of integrations) {
    try {
      const cfg = decryptIntegrationConfigForDispatch(integ.type, (integ.config as Record<string, any>) ?? {});
      if (integ.type === "slack" || integ.type === "teams" || integ.type === "discord") {
        await sendChatNotification(cfg.webhookUrl, alertCase, eventType, integ.type);
      } else if (integ.type === "generic_webhook") {
        await sendGenericWebhook(cfg, alertCase, eventType);
      } else if (integ.type === "pagerduty" || integ.type === "opsgenie") {
        await sendPagingEvent(
          integ.type, cfg, `system_health:${jobKey}`, action,
          `${label}: ${detail}`, action === "trigger" ? "critical" : "low", { job: jobKey },
        );
      } else {
        continue;
      }
      await prisma.integration.update({ where: { id: integ.id }, data: { lastFiredAt: new Date(), fireCount: { increment: 1 }, lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.integration.update({ where: { id: integ.id }, data: { lastError: message.slice(0, 300) } }).catch(() => {});
      console.warn(`[Integrations] '${integ.name}' (${integ.type}) system health alert failed for '${jobKey}': ${message}`);
    }
  }

  await sendAlertEmail(
    "global",
    `[System Health] ${label} — ${action === "trigger" ? "DOWN" : "Recovered"}`,
    detail,
  );
}

/**
 * Scans every registered job and fires a one-time alert the moment it first
 * becomes unhealthy (3+ consecutive errors, or overdue past 3x its own
 * interval), then a one-time recovery notice once it reports healthy again
 * — port of `_check_system_health_and_alert` (main.py:17780).
 * `lastAlertSentAt` non-null is the "already notified" marker, mirroring
 * Case SLA's slaAckBreachNotifiedAt pattern.
 */
export async function checkSystemHealthAndAlert(): Promise<void> {
  const rows = await prisma.systemHealthJob.findMany();
  const byKey = new Map(rows.map((r) => [r.jobKey, r]));

  for (const meta of SYSTEM_HEALTH_JOBS) {
    const entry = byKey.get(meta.key);
    const consecutiveErrors = entry?.consecutiveErrors ?? 0;
    const overdue = isOverdue(meta.intervalSeconds, entry?.lastHeartbeatAt ?? null);
    const isUnhealthy = overdue || consecutiveErrors >= 3;
    const wasAlerted = Boolean(entry?.lastAlertSentAt);

    if (isUnhealthy && !wasAlerted) {
      const reason = consecutiveErrors >= 3
        ? `failed ${consecutiveErrors} times in a row`
        : "has not reported in over its expected interval — it may be stalled or crashed";
      await fireSystemHealthAlert(meta.key, meta.label, "trigger", `${meta.label} ${reason}.`);
      await prisma.systemHealthJob.upsert({
        where: { jobKey: meta.key },
        create: { jobKey: meta.key, status: "error", lastAlertSentAt: new Date() },
        update: { lastAlertSentAt: new Date() },
      });
    } else if (!isUnhealthy && wasAlerted) {
      await fireSystemHealthAlert(meta.key, meta.label, "resolve", `${meta.label} has recovered.`);
      await prisma.systemHealthJob.update({ where: { jobKey: meta.key }, data: { lastAlertSentAt: null } });
    }
  }
}
