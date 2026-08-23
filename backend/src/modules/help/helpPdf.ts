import { marked } from "marked";

/**
 * Renders one of the vendored help docs (backend/docs/*.md) into a
 * print-ready standalone HTML document for the "Download as PDF" action
 * (help.controller.ts's GET /api/help/:docSlug/pdf), then handed to
 * htmlToPdf.ts's shared Puppeteer renderer — the same one reports.service.ts
 * uses for scheduled/on-demand analytics reports.
 *
 * Deliberately simpler than the frontend's renderHelpDoc (lib/helpDocs.ts):
 * no heading-id slugging or cross-doc link interception needed here — a
 * downloaded PDF is a flat, standalone document, not an interactive modal
 * with in-app navigation between guides.
 */
export function renderHelpDocPdfHtml(markdown: string, title: string): string {
  const bodyHtml = marked.parse(markdown, { gfm: true, breaks: false }) as string;
  const generatedOn = new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.55; margin: 0; padding: 0; }
  .cover { padding: 8mm 0 10mm; border-bottom: 2px solid #0241e3; margin-bottom: 8mm; }
  .cover .brand { font-size: 9pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #0241e3; margin-bottom: 4mm; }
  .cover h1 { font-size: 20pt; font-weight: 700; margin: 0 0 2mm; color: #111827; }
  .cover .meta { font-size: 8.5pt; color: #6b7280; }
  h1 { font-size: 15pt; font-weight: 700; margin: 9mm 0 3mm; color: #111827; page-break-after: avoid; }
  h2 { font-size: 13pt; font-weight: 700; margin: 7mm 0 3mm; padding-top: 3mm; border-top: 1px solid #e5e7eb; color: #111827; page-break-after: avoid; }
  h3 { font-size: 11.5pt; font-weight: 700; margin: 5mm 0 2mm; color: #111827; page-break-after: avoid; }
  h4 { font-size: 10.5pt; font-weight: 700; margin: 4mm 0 2mm; color: #111827; page-break-after: avoid; }
  p { margin: 0 0 3mm; }
  a { color: #0241e3; text-decoration: underline; }
  ul, ol { margin: 0 0 3mm; padding-left: 5mm; }
  li { margin-bottom: 1mm; }
  strong { font-weight: 700; color: #111827; }
  code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 9pt; background: #f3f4f6; padding: 0.5mm 1.2mm; border-radius: 1mm; }
  pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 2mm; padding: 3mm; margin: 0 0 3mm; overflow-x: auto; page-break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: 8.5pt; }
  blockquote { border-left: 2px solid #d1d5db; margin: 0 0 3mm; padding: 1mm 0 1mm 4mm; color: #6b7280; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 9.5pt; page-break-inside: avoid; }
  th { text-align: left; font-weight: 700; padding: 1.5mm 2.5mm; background: #f3f4f6; border: 1px solid #e5e7eb; }
  td { padding: 1.5mm 2.5mm; border: 1px solid #e5e7eb; vertical-align: top; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 6mm 0; }
</style>
</head>
<body>
  <div class="cover">
    <div class="brand">Applivery SOAR</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">Generated ${generatedOn} — from the in-app Help guide. Content may be updated in the app after this was downloaded.</div>
  </div>
  ${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
