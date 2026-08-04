import { Router } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";

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
  readme: "README.md",
  architecture: "ARCHITECTURE.md",
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

helpRouter.get("/api/help", verifyDashboardToken, asyncHandler(async (_req, res) => {
  res.json({
    items: Object.entries(HELP_DOC_SLUGS).map(([slug, filename]) => ({ slug, available: findHelpDocPath(filename) !== null })),
  });
}));
