import { Router } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { renderHtmlToPdf } from "../../utils/htmlToPdf";
import { renderHelpDocPdfHtml } from "./helpPdf";

/**
 * In-app admin/developer guides — port of main.py:17848-17893
 * (`_resolve_docs_dir`/`get_help_doc`/`list_help_docs`). Serves the vendored
 * markdown docs (docs/*.md, README.md, ARCHITECTURE.md — copied into
 * backend/docs at build time, see Dockerfile) that HelpModal.vue renders in
 * a modal. Both endpoints stay dashboard-token gated, same as the original
 * (a logged-in admin, not an unattended caller).
 */

export const helpRouter = Router();

const DOCS_DIR = path.resolve(__dirname, "../../../docs");

const HELP_DOC_SLUGS: Record<string, string> = {
  overview: "overview.md",
  devices: "devices.md",
  compliance: "compliance.md",
  cases: "cases.md",
  workflows: "workflows.md",
  reporting: "reporting.md",
  settings: "settings.md",
  "audit-logs": "audit-logs.md",
  playground: "playground.md",
  geofencing: "geofencing.md",
  apps: "apps.md",
  "edr-xdr-mtd-dex-integration-guide": "edr-xdr-mtd-dex-integration-guide.md",
  readme: "README.md",
  architecture: "ARCHITECTURE.md",
};

// Mirrors frontend/src/lib/helpDocs.ts's DOC_TITLES — only used here for the
// downloaded PDF's cover title and Content-Disposition filename, so it's
// fine (and simpler) for this to be its own small copy rather than shared
// code across the backend/frontend boundary, same as HELP_DOC_SLUGS itself
// already mirrors DOC_FILE_TO_SLUG.
const HELP_DOC_TITLES: Record<string, string> = {
  overview: "Overview — Admin Guide",
  devices: "Devices — Admin Guide",
  compliance: "Compliance — Admin Guide",
  cases: "Cases — Admin Guide",
  workflows: "Workflows — Admin Guide",
  reporting: "Reporting — Admin Guide",
  settings: "Settings — Admin Guide",
  "audit-logs": "Audit Logs — Admin Guide",
  playground: "Playground — Admin Guide",
  geofencing: "Geofencing — Admin Guide",
  apps: "Apps — Admin Guide",
  "edr-xdr-mtd-dex-integration-guide": "Applivery SOAR Integration Guide — EDR, XDR, MTD & DEX",
  readme: "README",
  architecture: "Architecture Guide",
};

function findHelpDocPath(filename: string): string | null {
  const p = path.join(DOCS_DIR, filename);
  return existsSync(p) ? p : null;
}

helpRouter.get("/api/help/:docSlug", verifyDashboardToken, asyncHandler(async (req, res) => {
  const filename = HELP_DOC_SLUGS[req.params.docSlug];
  if (!filename) throw new HttpError(404, "Unknown help document");
  const filePath = findHelpDocPath(filename);
  if (!filePath) {
    throw new HttpError(404, "This deployment doesn't have its help docs bundled — rebuild the image to include them.");
  }
  res.json({ slug: req.params.docSlug, content: readFileSync(filePath, "utf-8") });
}));

// GET /api/help/:docSlug/pdf — same content as the JSON endpoint above,
// rendered to a standalone PDF for offline reading/sharing (e.g. with an
// EDR/XDR/MTD/DEX vendor's own integration team, who won't have a SOAR
// login). Reuses the exact Puppeteer pipeline reports.service.ts already
// uses for analytics reports (see utils/htmlToPdf.ts).
helpRouter.get("/api/help/:docSlug/pdf", verifyDashboardToken, asyncHandler(async (req, res) => {
  const filename = HELP_DOC_SLUGS[req.params.docSlug];
  if (!filename) throw new HttpError(404, "Unknown help document");
  const filePath = findHelpDocPath(filename);
  if (!filePath) {
    throw new HttpError(404, "This deployment doesn't have its help docs bundled — rebuild the image to include them.");
  }
  const markdown = readFileSync(filePath, "utf-8");
  const title = HELP_DOC_TITLES[req.params.docSlug] ?? req.params.docSlug;
  const html = renderHelpDocPdfHtml(markdown, title);
  const pdfBuffer = await renderHtmlToPdf(html);

  const safeName = req.params.docSlug.replace(/[^a-z0-9-]/gi, "_");
  res.setHeader("Content-Disposition", `attachment; filename=Applivery_SOAR_${safeName}.pdf`);
  res.setHeader("Content-Type", "application/pdf");
  res.send(pdfBuffer);
}));

helpRouter.get("/api/help", verifyDashboardToken, asyncHandler(async (_req, res) => {
  res.json({
    items: Object.entries(HELP_DOC_SLUGS).map(([slug, filename]) => ({ slug, available: findHelpDocPath(filename) !== null })),
  });
}));
