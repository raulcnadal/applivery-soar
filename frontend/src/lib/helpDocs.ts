import { marked } from "marked";

/**
 * Renders the admin/developer guide markdown (docs/*.md, README.md,
 * ARCHITECTURE.md, served via GET /api/help/:slug) into HTML, with heading
 * ids matching github-slugger's exact algorithm — the same slugger
 * rehype-slug used in the original React app (HelpModal.jsx), and the one
 * the docs' own hand-authored cross-links/anchors were verified against.
 *
 * Slugger algorithm (verified against real heading text in docs/*.md, e.g.
 * "Backup & Restore" -> "backup--restore", "Script & OMA-URI Library" ->
 * "script--oma-uri-library"): lowercase, strip any character that isn't a
 * word char/space/hyphen (punctuation just vanishes, leaving whichever
 * whitespace was already adjacent to it), then map every remaining space to
 * a hyphen — no trimming, no collapsing repeated hyphens/spaces.
 */
function slugify(text: string, used: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/ /g, "-");
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

// Maps the relative .md filenames used inside the docs' own cross-links
// (e.g. "devices.md#playground", "../ARCHITECTURE.md") to the backend's
// whitelisted slugs. Must mirror HELP_DOC_SLUGS in backend/src/modules/help/help.controller.ts.
export const DOC_FILE_TO_SLUG: Record<string, string> = {
  "overview.md": "overview",
  "devices.md": "devices",
  "compliance.md": "compliance",
  "cases.md": "cases",
  "workflows.md": "workflows",
  "reporting.md": "reporting",
  "settings.md": "settings",
  "audit-logs.md": "audit-logs",
  "playground.md": "playground",
  "README.md": "readme",
  "ARCHITECTURE.md": "architecture",
};

export const DOC_TITLES: Record<string, string> = {
  overview: "Overview — Admin Guide",
  devices: "Devices — Admin Guide",
  compliance: "Compliance — Admin Guide",
  cases: "Cases — Admin Guide",
  workflows: "Workflows — Admin Guide",
  reporting: "Reporting — Admin Guide",
  settings: "Settings — Admin Guide",
  "audit-logs": "Audit Logs — Admin Guide",
  playground: "Playground — Admin Guide",
  readme: "README",
  architecture: "Architecture Guide",
};

export interface RenderedDoc {
  html: string;
}

/**
 * Renders markdown to HTML with heading ids injected and every link tagged
 * so HelpModal.vue can intercept clicks: internal cross-doc links get
 * `data-doc-slug`/`data-doc-anchor` attributes (same regex the original's
 * handleLinkClick used to recognize "devices.md#anchor"-style hrefs),
 * same-doc "#anchor" links are left as plain hash hrefs (handled via a
 * scrollIntoView listener), and anything else opens in a new tab.
 */
export function renderHelpDoc(markdown: string): RenderedDoc {
  const used = new Map<string, number>();
  const renderer = new marked.Renderer();

  // marked@12's Renderer uses the classic positional-argument API
  // (text, level, raw) / (href, title, text) — verified directly against
  // the installed version rather than assumed from marked's newer
  // token-object API, which a different major version uses instead.
  renderer.heading = (text: string, level: number, raw: string) => {
    const id = slugify(raw, used);
    return `<h${level} id="${id}">${text}</h${level}>\n`;
  };

  renderer.link = (href: string | null, title: string | null | undefined, text: string) => {
    const titleAttr = title ? ` title="${title}"` : "";
    if (!href) return text;
    if (href.startsWith("#")) {
      return `<a href="${href}" data-doc-anchor="${href.slice(1)}"${titleAttr}>${text}</a>`;
    }
    const m = href.match(/^(?:\.\.?\/)?(?:docs\/)?([\w-]+\.md)(#.*)?$/i);
    if (m && DOC_FILE_TO_SLUG[m[1]]) {
      const anchor = m[2] ? m[2].slice(1) : "";
      return `<a href="${href}" data-doc-slug="${DOC_FILE_TO_SLUG[m[1]]}" data-doc-anchor="${anchor}"${titleAttr}>${text}</a>`;
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
  };

  const html = marked.parse(markdown, { renderer, gfm: true, breaks: false }) as string;
  return { html };
}
