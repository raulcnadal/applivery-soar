import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderHelpDocPdfHtml } from "./helpPdf";

/**
 * Doesn't invoke Puppeteer (no Chromium binary in CI/this sandbox — same
 * limitation reports.service.ts's PDF path already has) — just verifies the
 * markdown->HTML stage that feeds it. Runs against the real, checked-in EDR/
 * XDR/MTD/DEX Integration Guide specifically because that's the doc most
 * likely to have a markdown authoring slip (heavy table/code-block usage)
 * that `marked` chokes on or mangles silently.
 */
describe("renderHelpDocPdfHtml", () => {
  it("renders the EDR/XDR/MTD/DEX Integration Guide without throwing, with tables and headings intact", () => {
    const docPath = path.resolve(__dirname, "../../../docs/edr-xdr-mtd-dex-integration-guide.md");
    const markdown = fs.readFileSync(docPath, "utf-8");
    const html = renderHelpDocPdfHtml(markdown, "Applivery SOAR Integration Guide — EDR, XDR, MTD & DEX");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h1>Applivery SOAR Integration Guide");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    // The guide's own curl examples should survive as fenced code blocks, not get mangled into inline text.
    expect(html).toContain("<pre><code");
    expect(html).toContain("api/triggers/fire");
  });

  it("escapes the title against HTML injection", () => {
    const html = renderHelpDocPdfHtml("Body text.", '<script>alert(1)</script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
