import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { CloseCircle as X, AltArrowLeft as ArrowLeft, DangerTriangle as AlertTriangle } from '@solar-icons/react';

// Maps the relative .md filenames used inside the docs' own cross-links
// (e.g. "devices.md#playground", "../ARCHITECTURE.md") to the backend's
// whitelisted slugs. Must mirror HELP_DOC_SLUGS in big-picture-api/main.py —
// if a new guide is added there, add its filename here too.
const DOC_FILE_TO_SLUG = {
  'overview.md': 'overview',
  'devices.md': 'devices',
  'compliance.md': 'compliance',
  'cases.md': 'cases',
  'workflows.md': 'workflows',
  'reporting.md': 'reporting',
  'settings.md': 'settings',
  'audit-logs.md': 'audit-logs',
  'playground.md': 'playground',
  'README.md': 'readme',
  'ARCHITECTURE.md': 'architecture',
};

export const DOC_TITLES = {
  overview: 'Overview — Admin Guide',
  devices: 'Devices — Admin Guide',
  compliance: 'Compliance — Admin Guide',
  cases: 'Cases — Admin Guide',
  workflows: 'Workflows — Admin Guide',
  reporting: 'Reporting — Admin Guide',
  settings: 'Settings — Admin Guide',
  'audit-logs': 'Audit Logs — Admin Guide',
  playground: 'Playground — Admin Guide',
  readme: 'README',
  architecture: 'Architecture Guide',
};

// Scrolls to a heading id inside the modal body once react-markdown has
// painted it (rehype-slug generates the same github-slugger ids the docs'
// own links were hand-verified against during authoring).
function useScrollToAnchor(bodyRef, status, anchor) {
  useEffect(() => {
    if (status !== 'ready' || !anchor) return undefined;
    const frame = requestAnimationFrame(() => {
      const el = bodyRef.current && bodyRef.current.querySelector(`#${CSS.escape(anchor)}`);
      if (el) el.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [status, anchor, bodyRef]);
}

// Themed component overrides for react-markdown — no typography plugin is
// installed in this project, so headings/tables/links/code are styled by
// hand here to match the app's existing card/border/text theme tokens.
function buildMdComponents(theme, onLinkClick) {
  return {
    h1: ({ children }) => <h1 className="text-lg font-semibold mt-6 mb-3 first:mt-0" style={{ color: theme.text }}>{children}</h1>,
    h2: ({ children, id }) => <h2 id={id} className="text-base font-semibold mt-6 mb-2 pt-4 first:mt-0 first:pt-0" style={{ color: theme.text, borderTop: `1px solid ${theme.border}` }}>{children}</h2>,
    h3: ({ children, id }) => <h3 id={id} className="text-sm font-semibold mt-4 mb-2" style={{ color: theme.text }}>{children}</h3>,
    h4: ({ children, id }) => <h4 id={id} className="text-sm font-semibold mt-3 mb-1.5" style={{ color: theme.text }}>{children}</h4>,
    p: ({ children }) => <p className="text-sm leading-relaxed mb-3" style={{ color: theme.textBody || theme.text }}>{children}</p>,
    a: ({ children, href }) => (
      <a href={href} onClick={(e) => onLinkClick(e, href)} className="underline decoration-dotted underline-offset-2 hover:opacity-80" style={{ color: theme.brandAccent || '#0241E3' }}>
        {children}
      </a>
    ),
    ul: ({ children }) => <ul className="list-disc pl-5 text-sm mb-3 space-y-1" style={{ color: theme.textBody || theme.text }}>{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-5 text-sm mb-3 space-y-1" style={{ color: theme.textBody || theme.text }}>{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold" style={{ color: theme.text }}>{children}</strong>,
    code: ({ children, className }) => {
      const isBlock = /language-/.test(className || '');
      return isBlock ? (
        <code className={`block text-xs font-mono p-3 rounded-lg overflow-x-auto ${className || ''}`} style={{ backgroundColor: theme.bg, color: theme.textBody || theme.text, border: `1px solid ${theme.border}` }}>{children}</code>
      ) : (
        <code className="text-[13px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: theme.bg, color: theme.textBody || theme.text }}>{children}</code>
      );
    },
    pre: ({ children }) => <pre className="mb-3">{children}</pre>,
    blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 my-3 text-sm italic" style={{ borderColor: theme.border, color: theme.textMuted }}>{children}</blockquote>,
    hr: () => <hr className="my-5" style={{ borderColor: theme.border }} />,
    table: ({ children }) => (
      <div className="overflow-x-auto mb-4 rounded-lg" style={{ border: `1px solid ${theme.border}` }}>
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead style={{ backgroundColor: theme.bg }}>{children}</thead>,
    th: ({ children }) => <th className="text-left font-semibold px-3 py-2 text-xs" style={{ color: theme.textMuted, borderBottom: `1px solid ${theme.border}` }}>{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 align-top" style={{ color: theme.textBody || theme.text, borderTop: `1px solid ${theme.border}` }}>{children}</td>,
  };
}

// Full-featured markdown viewer for the in-app admin/developer guides
// (docs/*.md, README.md, ARCHITECTURE.md, served via GET /api/help/{slug}).
// Cross-doc links inside the markdown (e.g. "settings.md#integrations")
// switch the modal to that doc in place instead of navigating away, with a
// small back-button history stack; same-doc "#anchor" links scroll within
// the modal. Opened via <HelpIcon /> below — most call sites shouldn't need
// to use this directly.
export default function HelpModal({ slug: initialSlug, anchor: initialAnchor, theme, onClose }) {
  const [slug, setSlug] = useState(initialSlug);
  const [anchor, setAnchor] = useState(initialAnchor || null);
  const [history, setHistory] = useState([]);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const bodyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    axios.get(`/api/help/${slug}`).then((res) => {
      if (cancelled) return;
      setContent((res.data && res.data.content) || '');
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [slug]);

  useScrollToAnchor(bodyRef, status, anchor);

  const navigateTo = useCallback((targetSlug, targetAnchor) => {
    setHistory((h) => [...h, { slug, anchor }]);
    setSlug(targetSlug);
    setAnchor(targetAnchor || null);
  }, [slug, anchor]);

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setSlug(prev.slug);
      setAnchor(prev.anchor || null);
      return h.slice(0, -1);
    });
  }, []);

  const handleLinkClick = useCallback((e, href) => {
    if (!href) return;
    if (href.startsWith('#')) {
      e.preventDefault();
      const id = href.slice(1);
      const el = bodyRef.current && bodyRef.current.querySelector(`#${CSS.escape(id)}`);
      if (el) el.scrollIntoView({ block: 'start' });
      return;
    }
    const m = href.match(/^(?:\.\.?\/)?(?:docs\/)?([\w-]+\.md)(#.*)?$/i);
    if (m && DOC_FILE_TO_SLUG[m[1]]) {
      e.preventDefault();
      navigateTo(DOC_FILE_TO_SLUG[m[1]], m[2] ? m[2].slice(1) : null);
      return;
    }
    // External link — open in a new tab rather than navigating the dashboard away.
    e.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }, [navigateTo]);

  const mdComponents = React.useMemo(() => buildMdComponents(theme, handleLinkClick), [theme, handleLinkClick]);

  // Rendered via a portal straight onto <body> rather than in place. Several
  // call sites (e.g. the Playground header bar) sit under an ancestor with
  // backdrop-filter/transform, which creates a new containing block for
  // `position: fixed` descendants in every modern browser — without the
  // portal, "fixed inset-0" resolves against that small ancestor's box
  // instead of the viewport, so the overlay renders as a clipped, undimmed
  // fragment instead of a proper full-screen modal. Portaling to <body>
  // sidesteps the issue regardless of where <HelpIcon> is mounted.
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: theme.card, maxHeight: '85vh' }}>
        <div className="flex items-center gap-2 px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          {history.length > 0 && (
            <button onClick={goBack} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/8 transition-colors shrink-0" style={{ color: theme.textMuted }} title="Back">
              <ArrowLeft size={14} />
            </button>
          )}
          <h3 className="text-sm font-semibold flex-1 truncate" style={{ color: theme.text }}>{DOC_TITLES[slug] || slug}</h3>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/8 transition-colors shrink-0" style={{ color: theme.textMuted }} title="Close">
            <X size={16} />
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto flex-1 px-6 py-5">
          {status === 'loading' && (
            <div className="text-sm py-8 text-center" style={{ color: theme.textMuted }}>Loading guide…</div>
          )}
          {status === 'error' && (
            <div className="flex items-start gap-2 text-sm py-8 justify-center text-center" style={{ color: theme.textMuted }}>
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>Couldn't load this guide. It may not be bundled in this deployment yet.</span>
            </div>
          )}
          {status === 'ready' && (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={mdComponents}>
              {content}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
