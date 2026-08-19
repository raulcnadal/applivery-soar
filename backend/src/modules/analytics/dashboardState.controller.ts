import { Router } from "express";
import { z } from "zod";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { encryptSecret } from "../../utils/secretCipher";
import { decryptSmtpConfig } from "../../services/smtpConfig";
import { validateCustomReportTemplate } from "../reports/reportTemplate";

/**
 * Port of the "STORAGE ENDPOINTS" / "UNIFIED STATE PERSISTENCE" sections
 * (main.py:1596-1719): `/api/layout` (legacy, unused by the frontend — see
 * schema.prisma's WorkspaceState.dashboard doc comment) and `/api/state`
 * (the ACTUAL Overview dashboard/theme/webhook/SMTP/scheduled-reports
 * persistence, shared across every user of this deployment — the frontend
 * always sends `X-Workspace-Slug: global` for these two endpoints
 * specifically, unlike every other API call, which sends the real org
 * slug — see App.jsx's own hardcoded 'global' header on every /api/state
 * call).
 */

export const dashboardStateRouter = Router();

const LEGACY_LAYOUT_SLUG = "global";
const LEGACY_LAYOUT_USER = "global";

function slugKeyFrom(header: string | undefined): string {
  const raw = (header ?? "global").replace(/[^a-zA-Z0-9_-]/g, "_");
  return raw === "" || raw === "None" || raw === "null" ? "global" : raw;
}

// GET /api/layout (main.py:1613) — legacy/unused; kept for API parity.
dashboardStateRouter.get(
  "/api/layout",
  verifyDashboardToken,
  asyncHandler(async (_req, res) => {
    const row = await prisma.widgetLayout.findUnique({ where: { workspaceSlug_userEmail: { workspaceSlug: LEGACY_LAYOUT_SLUG, userEmail: LEGACY_LAYOUT_USER } } });
    res.json(row?.layout ?? { widgets: [], layout: [] });
  }),
);

// POST /api/layout (main.py:1617) — NOTE: persists payload.layout (an array)
// as the entire stored value, not wrapped in the {widgets, layout} shape GET
// returns as its default — a pre-existing read/write shape mismatch in the
// original, preserved as-is rather than "fixed".
dashboardStateRouter.post(
  "/api/layout",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const layout = req.body?.layout ?? [];
    await prisma.widgetLayout.upsert({
      where: { workspaceSlug_userEmail: { workspaceSlug: LEGACY_LAYOUT_SLUG, userEmail: LEGACY_LAYOUT_USER } },
      create: { workspaceSlug: LEGACY_LAYOUT_SLUG, userEmail: LEGACY_LAYOUT_USER, layout },
      update: { layout },
    });
    res.json({ status: "success" });
  }),
);

const SESSION_TIMEOUT_MIN_MINUTES = 30;
const SESSION_TIMEOUT_MAX_MINUTES = 480;

function clampSessionTimeout(minutes: number | null | undefined): number | null | undefined {
  if (minutes === null || minutes === undefined) return minutes;
  return Math.max(SESSION_TIMEOUT_MIN_MINUTES, Math.min(SESSION_TIMEOUT_MAX_MINUTES, Math.trunc(minutes)));
}

function retentionLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "unset";
  return days <= 0 ? "forever" : `${days} days`;
}

const statePayloadSchema = z.object({
  dashboard: z.record(z.any()).nullable().optional(),
  themeMode: z.string().nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  smtpConfig: z.record(z.any()).nullable().optional(),
  scheduledReports: z.array(z.record(z.any())).nullable().optional(),
  timezone: z.string().nullable().optional(),
  customReportTemplate: z.string().nullable().optional(),
  auditLogRetentionDays: z.number().int().nullable().optional(),
  sessionTimeoutMinutes: z.number().int().nullable().optional(),
  installedAppsRefreshBudgetPerHour: z.number().int().nullable().optional(),
});

function stateResponseShape(row: Awaited<ReturnType<typeof prisma.workspaceState.findUnique>>): Record<string, unknown> {
  if (!row) return {};
  const out: Record<string, unknown> = {
    dashboard: row.dashboard ?? undefined,
    themeMode: row.themeMode ?? undefined,
    webhookUrl: row.webhookUrl ?? undefined,
    smtpConfig: decryptSmtpConfig(row.smtpConfig as any) ?? undefined,
    scheduledReports: row.scheduledReports ?? undefined,
    timezone: row.timezone ?? undefined,
    customReportTemplate: row.customReportTemplate ?? undefined,
    auditLogRetentionDays: row.auditLogRetentionDays ?? undefined,
    sessionTimeoutMinutes: row.sessionTimeoutMinutes ?? undefined,
    installedAppsRefreshBudgetPerHour: row.installedAppsRefreshBudgetPerHour ?? undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// GET /api/state (main.py:1683)
dashboardStateRouter.get(
  "/api/state",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const slugKey = slugKeyFrom(req.header("X-Workspace-Slug"));
    const row = await prisma.workspaceState.findUnique({ where: { workspaceSlug: slugKey } });
    res.json(stateResponseShape(row));
  }),
);

// POST /api/state (main.py:1687)
dashboardStateRouter.post(
  "/api/state",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const slugKey = slugKeyFrom(req.header("X-Workspace-Slug"));
    const payload = statePayloadSchema.parse(req.body ?? {});

    // Reject a broken custom HTML report template before it ever reaches the
    // DB — the alternative is it silently breaks the next scheduled report
    // run, which nobody's watching in real time (see reportTemplate.ts's
    // validateCustomReportTemplate doc comment for exactly what this catches
    // and what it deliberately can't).
    if (typeof payload.customReportTemplate === "string") {
      const result = validateCustomReportTemplate(payload.customReportTemplate);
      if (!result.valid) throw new HttpError(400, result.error || "Custom report template failed validation.");
    }

    const existingRow = await prisma.workspaceState.findUnique({ where: { workspaceSlug: slugKey } });
    const existing = stateResponseShape(existingRow);

    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined && v !== null) update[k] = v;
    }
    if ("sessionTimeoutMinutes" in update) {
      update.sessionTimeoutMinutes = clampSessionTimeout(update.sessionTimeoutMinutes as number);
    }
    if (update.smtpConfig && typeof update.smtpConfig === "object" && (update.smtpConfig as any).pass) {
      update.smtpConfig = { ...(update.smtpConfig as any), pass: encryptSecret((update.smtpConfig as any).pass) };
    }

    const actor = req.dashboardUser?.sub ?? "unknown";
    if ("auditLogRetentionDays" in update && update.auditLogRetentionDays !== existing.auditLogRetentionDays) {
      await recordAuditEvent(slugKey, {
        category: "settings", action: "audit_retention_changed", severity: "info", actor,
        message: `Audit log retention changed to ${retentionLabel(update.auditLogRetentionDays as number)}`,
      });
    }
    if ("sessionTimeoutMinutes" in update && update.sessionTimeoutMinutes !== existing.sessionTimeoutMinutes) {
      await recordAuditEvent(slugKey, {
        category: "settings", action: "session_timeout_changed", severity: "info", actor,
        message: `Idle session timeout changed to ${update.sessionTimeoutMinutes} minutes`,
      });
    }

    await prisma.workspaceState.upsert({
      where: { workspaceSlug: slugKey },
      create: { workspaceSlug: slugKey, ...update } as any,
      update: update as any,
    });
    res.json({ status: "ok" });
  }),
);
