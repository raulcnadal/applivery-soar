import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { reportPayloadSchema } from "./reports.schemas";
import { generateReportPdf, sendEmailReport, sendGoogleChatWebhook } from "./reports.service";

export const reportsRouter = Router();

// POST /api/reports/generate (main.py:15608)
reportsRouter.post(
  "/api/reports/generate",
  verifyDashboardToken,
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
