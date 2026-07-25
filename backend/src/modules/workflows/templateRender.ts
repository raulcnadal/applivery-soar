/**
 * Minimal port of the original's Jinja2 `Template(str).render(**context)`
 * calls used throughout the Workflow engine (http_request/notification/
 * customOmaUri/scheduleOsUpdate steps, dry-run's `describe_step`) — every
 * one of those call sites only ever does simple `{{ device.x.y }}` dotted
 * variable interpolation against a `{device: {...}}` context, never a
 * Jinja `{% %}` control-flow tag or a `|filter` (confirmed by grepping
 * main.py for both — zero matches), so a full template engine dependency
 * isn't needed: this regex + dotted-path resolver is a faithful,
 * behavior-equivalent substitute for exactly what's actually used.
 *
 * Matches Jinja's own "undefined renders as empty string" default — an
 * unresolvable path (missing key, null anywhere along the chain) renders
 * as '', never "undefined"/"null"/an exception.
 */
export function renderTemplate(input: string | null | undefined, context: Record<string, unknown>): string {
  if (!input) return input ?? "";
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
      return (acc as Record<string, unknown>)[key];
    }, context);
    return value === undefined || value === null ? "" : String(value);
  });
}
