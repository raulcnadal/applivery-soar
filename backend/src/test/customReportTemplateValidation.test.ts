import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_TEMPLATE_SOURCE, validateCustomReportTemplate } from "../modules/reports/reportTemplate";

/**
 * validateCustomReportTemplate (reportTemplate.ts) — the gate
 * dashboardState.controller.ts's POST /api/state runs before persisting a
 * custom HTML report template, so a broken one fails loudly in Settings
 * instead of silently in the next scheduled report run. Covers the same
 * checks in the same order the function itself documents.
 */
describe("validateCustomReportTemplate", () => {
  it("accepts a blank/whitespace-only template (means: fall back to default)", () => {
    expect(validateCustomReportTemplate("")).toEqual({ valid: true });
    expect(validateCustomReportTemplate("   \n  ")).toEqual({ valid: true });
  });

  it("accepts the downloadable default-template starting point unmodified", () => {
    expect(validateCustomReportTemplate(DEFAULT_CUSTOM_TEMPLATE_SOURCE)).toEqual({ valid: true });
  });

  it("accepts a minimal valid template using only supported grammar", () => {
    const html = `<!DOCTYPE html><html><body>
      <h1>{{ Report_Title }}</h1>
      {% for m in metadata %}<div>{{ m.label }}: {{ m.value }}</div>{% endfor %}
      {% for s in report_sections %}
        <h2>{{ s.section_title }}</h2>
        {% if s.html_table %}{{ s.html_table | safe }}{% endif %}
      {% endfor %}
    </body></html>`;
    expect(validateCustomReportTemplate(html)).toEqual({ valid: true });
  });

  it("rejects an unclosed {% for %} block", () => {
    const html = `<!DOCTYPE html><html><body>{% for s in report_sections %}<h2>{{ s.section_title }}</h2></body></html>`;
    const result = validateCustomReportTemplate(html);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/for.*endfor/i);
  });

  it("rejects an unclosed {% if %} block", () => {
    const html = `<!DOCTYPE html><html><body>{% for s in report_sections %}{% if s.html_table %}{{ s.html_table }}{% endfor %}</body></html>`;
    const result = validateCustomReportTemplate(html);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/if.*endif/i);
  });

  it("rejects a loop over a source the renderer doesn't support", () => {
    const html = `<!DOCTYPE html><html><body>{% for d in devices %}{{ d.name }}{% endfor %}</body></html>`;
    const result = validateCustomReportTemplate(html);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/devices/);
  });

  it("rejects a fragment with no <!DOCTYPE html> or <html> tag", () => {
    const result = validateCustomReportTemplate("<div>{{ Report_Title }}</div>");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/full HTML document/i);
  });
});
