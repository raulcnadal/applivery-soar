import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { env } from "../config/env";

/**
 * Shared Puppeteer-backed HTML->PDF renderer. Extracted from
 * reports.service.ts (originally the only PDF producer in the app) so the
 * Help Docs PDF export (help.controller.ts) can reuse the exact same
 * Chromium-resolution and launch logic instead of duplicating it — both are
 * "render some server-built HTML to a PDF buffer" with no other shared
 * state, so a stateless module-level function is enough; no need for a
 * class or a long-lived browser instance (PDF exports are infrequent,
 * on-demand, admin-triggered actions, not a hot path).
 */

export function resolvePuppeteerExecutable(): string | undefined {
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

export interface HtmlToPdfOptions {
  /** Optional selector to wait for before printing — e.g. reports.service.ts's chart-ready flag. Best-effort: a timeout here just proceeds with whatever's rendered rather than failing the whole export. */
  waitForSelector?: string;
  waitTimeoutMs?: number;
}

export async function renderHtmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
  const executablePath = resolvePuppeteerExecutable();
  if (!executablePath) {
    throw new Error(
      "No Chromium executable found for PDF rendering. Set PUPPETEER_EXECUTABLE_PATH (the Docker image installs the `chromium` apk package and sets this automatically).",
    );
  }
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, { timeout: options.waitTimeoutMs ?? 5000 });
      } catch {
        // Proceed with whatever's rendered — same best-effort behavior the
        // original inline version had for reports without chart canvases.
      }
    }
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
