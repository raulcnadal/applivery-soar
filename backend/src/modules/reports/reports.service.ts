import fs from "node:fs";
import axios from "axios";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer-core";
import { env } from "../../config/env";
import { prisma } from "../../services/prisma";
import { getWidgetData, type WidgetResponse } from "../analytics/widgets.service";
import { buildReportHtml, type ReportDisplayOptions } from "./reportTemplate";
import type { ReportPayload } from "./reports.schemas";

/** Port of `send_google_chat_webhook` (main.py:2769-2796). Best-effort, never throws. */
export async function sendGoogleChatWebhook(webhookUrl: string, workspace: string, timeLapse: string, sourcesCount: number): Promise<void> {
  if (!webhookUrl) return;
  const payload = {
    cardsV2: [
      {
        cardId: "reportCard",
        card: {
          header: { title: "Analytics Report Generated", subtitle: `Workspace: ${workspace}`, imageUrl: "https://dashboard.applivery.io/images/logo-icon-blue.png", imageType: "CIRCLE" },
          sections: [
            {
              header: "Report Details",
              widgets: [{ textParagraph: { text: `An automated Applivery SOAR report was just generated.<br><br><b>Time Lapse:</b> ${timeLapse}<br><b>Data Sources Analyzed:</b> ${sourcesCount}` } }],
            },
          ],
        },
      },
    ],
  };
  try {
    await axios.post(webhookUrl, payload, { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.warn(`[Reports] Failed to send Google Chat webhook: ${e}`);
  }
}

/** Port of `send_email_report` (main.py:2798-2818). Best-effort, never throws. */
export async function sendEmailReport(smtpConfig: Record<string, any> | null | undefined, recipients: string | null | undefined, pdfBuffer: Buffer, orgName: string, timeLapse: string): Promise<void> {
  if (!smtpConfig?.host || !recipients) return;
  try {
    const port = Number(smtpConfig.port) || 587;
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port,
      secure: port === 465,
      auth: smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.pass || "" } : undefined,
    });
    await transporter.sendMail({
      from: smtpConfig.from || smtpConfig.user || "reports@applivery.com",
      to: recipients,
      subject: `[${orgName}] Analytics Report`,
      text: `Hello,\n\nPlease find attached the automated Applivery SOAR report for ${orgName}.\n\nTime Lapse: ${timeLapse}\n\nGenerated automatically.`,
      attachments: [{ filename: `Applivery_Report_${orgName}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
    });
  } catch (e) {
    console.warn(`[Reports] Failed to send SMTP email: ${e}`);
  }
}

function resolvePuppeteerExecutable(): string | undefined {
  if (env.puppeteerExecutablePath) return env.puppeteerExecutablePath;
  // Common local-dev fallbacks so `npm run dev` works without setting the env
  // var explicitly on a machine that already has a browser installed.
  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const executablePath = resolvePuppeteerExecutable();
  if (!executablePath) {
    throw new Error(
      "No Chromium executable found for report PDF rendering. Set PUPPETEER_EXECUTABLE_PATH (the Docker image installs the `chromium` apk package and sets this automatically).",
    );
  }
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    try {
      await page.waitForSelector('body[data-charts-ready="true"]', { timeout: 5000 });
    } catch {
      // No canvases on this report (table/scorecard-only sources) — fine.
    }
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export interface GeneratedReport {
  pdfBuffer: Buffer;
  filename: string;
  orgName: string;
}

/**
 * Orchestrates the full report build — port of `generate_report`
 * (main.py:15608-15779), minus the WeasyPrint/Matplotlib rendering step
 * (replaced by reportTemplate.ts + Puppeteer, see that module's doc
 * comment). The Google Chat webhook and SMTP email dispatch are the
 * caller's responsibility (reports.controller.ts fires them without
 * awaiting, mirroring the original's `BackgroundTasks` — the PDF response
 * shouldn't wait on either).
 */
export async function generateReportPdf(payload: ReportPayload, authorization: string, workspaceSlug: string): Promise<GeneratedReport> {
  let orgName = payload.workspace;
  try {
    const orgData = await getWidgetData({ source: "org_profile", filters: {}, authorization, workspaceSlug });
    orgName = orgData.orgProfile?.name ?? payload.workspace;
  } catch {
    /* fall back to workspace slug */
  }

  const reportData: Record<string, WidgetResponse | { error: string }> = {};
  for (const source of payload.sources) {
    try {
      reportData[source] = await getWidgetData({ source, filters: payload.filters, authorization, workspaceSlug });
    } catch (e) {
      reportData[source] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Literal port of `_load_state(x_workspace_slug).get("customReportTemplate")`
  // — reads the state row for the REPORT'S OWN workspace slug, not 'global'.
  // Preserved as-is even though this means a template saved via Settings
  // (which the frontend always writes to the 'global' row — see
  // dashboardState.controller.ts) will only ever be found here if this
  // deployment's real workspace slug happens to be 'global' too; that's a
  // pre-existing inconsistency in the original, not something introduced by
  // this port.
  let customTemplate: string | null = null;
  try {
    const stateRow = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
    customTemplate = stateRow?.customReportTemplate ?? null;
  } catch {
    /* no custom template available */
  }

  const activeFilters = Object.entries(payload.filters)
    .filter(([, v]) => v !== "all" && v !== false)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const html = buildReportHtml({
    workspaceName: orgName,
    workspaceSlug: payload.workspace,
    reportTitle: "Analytics Report",
    generatedDate: new Date().toISOString().slice(0, 16).replace("T", " "),
    timeLapse: payload.timeLapse,
    sourcesCount: payload.sources.length,
    activeFilters,
    reportData,
    display: payload.display as ReportDisplayOptions,
    customTemplate,
  });

  const pdfBuffer = await renderHtmlToPdf(html);
  return { pdfBuffer, filename: `Applivery_Report_${payload.workspace}.pdf`, orgName };
}
