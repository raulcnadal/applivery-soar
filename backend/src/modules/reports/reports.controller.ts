import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { prisma } from "../../services/prisma";
import { buildReportHtml, DEFAULT_CUSTOM_TEMPLATE_SOURCE, SAMPLE_REPORT_DATA } from "./reportTemplate";
import { reportPayloadSchema } from "./reports.schemas";
import { generateReportPdf, sendEmailReport, sendGoogleChatWebhook } from "./reports.service";

export const reportsRouter = Router();

// Previously only `verifyDashboardToken` — the `reporting` RBAC area was
// declared in SOAR_FEATURE_AREAS but not enforced anywhere (migration-plan.md
// §9 / ARCHITECTURE.md §2.4). Now actually gated: generating a report is a
// read of aggregated data (no reporting-area write action exists), so
// `level: "read"` is sufficient here.
const readReporting = [verifyDashboardToken, requirePermission({ area: "reporting", level: "read" })];

// POST /api/reports/generate (main.py:15608)
reportsRouter.post(
  "/api/reports/generate",
  ...readReporting,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing Credentials");

    const payload = reportPayloadSchema.parse(req.body);

    // Fire-and-forget, same as the original's BackgroundTasks — the PDF
    // response shouldn't wait on the chat notification.
    if (payload.webhookUrl) {
      void sendGoogleChatWebhook(payload.webhookUrl, payload.workspace, payload.timeLapse, payload.sources.length);
    }

    const { pdfBuffer, orgName } = await generateReportPdf(payload, authorization, workspaceSlug);

    if (payload.emailRecipients && payload.smtp) {
      void sendEmailReport(payload.smtp, payload.emailRecipients, pdfBuffer, orgName, payload.timeLapse);
    }

    res.setHeader("Content-Disposition", `attachment; filename=Applivery_Report_${payload.workspace}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  }),
);

// GET /api/reports/template/default — downloads the built-in default report
// template's SOURCE (not the runtime-generated markup buildReportHtml's
// default path produces, which relies on live Chart.js canvases/embedded
// fonts a custom template can't use — see DEFAULT_CUSTOM_TEMPLATE_SOURCE's
// own doc comment) as a starting point for writing a custom one.
reportsRouter.get(
  "/api/reports/template/default",
  ...readReporting,
  asyncHandler(async (_req, res) => {
    res.setHeader("Content-Disposition", "attachment; filename=default-report-template.html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(DEFAULT_CUSTOM_TEMPLATE_SOURCE);
  }),
);

// GET /api/reports/template/preview — renders whichever template is
// currently ACTIVE (the saved custom template if one is set, otherwise the
// built-in default) against representative sample data, and returns it as
// plain HTML (not a PDF — no Puppeteer round-trip needed) so the Reporting
// view can open it directly in a new browser tab for a fast visual check.
// Reads the same "global" WorkspaceState row generateReportPdf now reads
// (reports.service.ts) — the same fix, applied consistently, so this
// preview shows exactly what a real generated report will actually use.
reportsRouter.get(
  "/api/reports/template/preview",
  ...readReporting,
  asyncHandler(async (_req, res) => {
    let customTemplate: string | null = null;
    try {
      const stateRow = await prisma.workspaceState.findUnique({ where: { workspaceSlug: "global" } });
      customTemplate = stateRow?.customReportTemplate ?? null;
    } catch {
      /* no custom template available — falls back to the built-in default below */
    }

    const html = buildReportHtml({
      workspaceName: "Sample Workspace",
      workspaceSlug: "sample-workspace",
      reportTitle: "Analytics Report (Preview)",
      generatedDate: new Date().toISOString().slice(0, 16).replace("T", " "),
      timeLapse: "Last 30 days",
      sourcesCount: Object.keys(SAMPLE_REPORT_DATA).length,
      activeFilters: "None",
      reportData: SAMPLE_REPORT_DATA,
      display: { trend: true, donut: true, table: true },
      customTemplate,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }),
);
