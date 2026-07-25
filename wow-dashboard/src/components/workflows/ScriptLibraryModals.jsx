import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  CloseCircle as X, CodeFile as FileCode2, Magnifer as Search,
  DangerTriangle as AlertTriangle, Folder, TrashBinMinimalistic as Trash2,
  AddSquare as Plus, LinkCircle as LinkIcon, CheckCircle as CheckCircle2,
} from '@solar-icons/react';

const PRIMARY_BLUE = '#0241E3';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';

const PLATFORM_LABELS = { windows: 'Windows', macos: 'macOS' };

function ModalShell({ theme, title, subtitle, onClose, children, width = 640 }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-xl border shadow-lg flex flex-col"
        style={{ maxWidth: width, maxHeight: '85vh', borderColor: theme.border, backgroundColor: theme.card }}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b" style={{ borderColor: theme.border }}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate" style={{ color: theme.text }}>{title}</h3>
            {subtitle && <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg shrink-0 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ color: theme.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// ── Script content viewer / editor ──
// Fetches a script Asset's raw source (GET /api/script-assets/:id/content)
// and, in 'edit' mode, saves changes back as a new Asset version (PUT) —
// Applivery has no in-place content-replace endpoint, so "save" here always
// means "create vN, delete the old one, repoint library entries", handled
// entirely server-side; this modal just shows the resulting warning/summary.
export function ScriptContentModal({ theme, headers, mode = 'view', assetId, assetName, platform, onClose, onSaved }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios.get(`/api/script-assets/${assetId}/content`, { headers })
      .then(res => { if (!cancelled) setContent(res.data?.content || ''); })
      .catch(err => { if (!cancelled) setError(err.response?.data?.detail || err.message || 'Could not load script content'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await axios.put(`/api/script-assets/${assetId}`, { platform, content }, { headers });
      setSaveResult(res.data);
      if (onSaved) onSaved(res.data.asset);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-2.5 py-2 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all resize-none";
  const inputStyle = { border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text };

  return (
    <ModalShell theme={theme} title={assetName || 'Script content'} subtitle={mode === 'edit' ? 'Editing saves this as a new Applivery Asset version' : 'Read-only preview'} onClose={onClose} width={720}>
      {loading ? (
        <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
      ) : saveResult ? (
        <div className="space-y-2">
          <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: PRIMARY_BLUE }}>
            <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> Saved as "{saveResult.asset?.name}". The previous version stays on Applivery untouched. {saveResult.repointedLibraryEntryIds?.length ? `${saveResult.repointedLibraryEntryIds.length} library entr${saveResult.repointedLibraryEntryIds.length === 1 ? 'y' : 'ies'} repointed automatically.` : ''}
          </p>
          <div className="flex justify-end">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ backgroundColor: PRIMARY_BLUE }}>Done</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {error && (
            <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: DANGER }}>
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            readOnly={mode !== 'edit'}
            rows={20}
            className={inputCls}
            style={inputStyle}
          />
          {mode === 'edit' && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px]" style={{ color: theme.textMuted }}>Saves as a new Asset (name gets a " vN" suffix) — the old Asset is deleted and every library reference to it is repointed automatically.</p>
              <button
                onClick={handleSave}
                disabled={saving || !content.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                {saving ? 'Saving…' : 'Save as new version'}
              </button>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ── Bulk-fetch existing script Assets from Applivery ──
export function FetchFromApplieryModal({ theme, headers, onClose, onImported }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [platformFilter, setPlatformFilter] = useState('all');
  const [textFilter, setTextFilter] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  function load() {
    setItems(null);
    axios.get('/api/script-assets/browse', { headers, params: { platform: 'all' } })
      .then(res => { setItems(res.data.items || []); setError(res.data.error || null); })
      .catch(err => { setItems([]); setError(err.response?.data?.detail || err.message || 'Could not load scripts from Applivery'); });
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = (items || []).filter(it =>
    (platformFilter === 'all' || it.platform === platformFilter) &&
    (!textFilter.trim() || it.name.toLowerCase().includes(textFilter.trim().toLowerCase()))
  );

  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function handleImport() {
    const assets = filtered.filter(it => selected.has(it.id));
    if (!assets.length) return;
    setImporting(true);
    try {
      const res = await axios.post('/api/action-library/import', { assets }, { headers });
      setImportResult(res.data);
      if (onImported) onImported();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <ModalShell theme={theme} title="Fetch scripts from Applivery" subtitle="Every script Asset already uploaded to Applivery — select the ones to add as pickable references in the library below." onClose={onClose} width={680}>
      {importResult ? (
        <div className="space-y-2">
          <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: PRIMARY_BLUE }}>
            <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> Imported {importResult.imported.length} script{importResult.imported.length === 1 ? '' : 's'}{importResult.skippedCount ? ` (${importResult.skippedCount} already in the library, skipped)` : ''}.
          </p>
          <div className="flex justify-end">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ backgroundColor: PRIMARY_BLUE }}>Done</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: theme.textMuted }} />
              <input
                value={textFilter}
                onChange={(e) => setTextFilter(e.target.value)}
                placeholder="Filter by name…"
                className="w-full pl-7 pr-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
              />
            </div>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
            >
              <option value="all">All platforms</option>
              <option value="windows">Windows</option>
              <option value="macos">macOS</option>
            </select>
          </div>

          {error && (
            <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: DANGER }}>
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}

          {items === null ? (
            <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs" style={{ color: theme.textMuted }}>No scripts found.</p>
          ) : (
            <div className="rounded-lg border max-h-80 overflow-y-auto divide-y" style={{ borderColor: theme.border }}>
              {filtered.map(it => (
                <div key={it.id}>
                  <label className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer hover:bg-blue-500/5" style={{ borderColor: theme.border }}>
                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} disabled={it.alreadyInLibrary} />
                    <FileCode2 size={13} style={{ color: theme.textMuted }} className="shrink-0" />
                    <span className="text-xs flex-1 truncate" style={{ color: theme.text }}>{it.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-light border border-current/25 shrink-0" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>{PLATFORM_LABELS[it.platform] || it.platform}</span>
                    {it.alreadyInLibrary && <span className="text-[10px] shrink-0" style={{ color: theme.textMuted }}>In library</span>}
                    <button type="button" onClick={(e) => { e.preventDefault(); setPreviewId(previewId === it.id ? null : it.id); }} className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ color: PRIMARY_BLUE }}>
                      {previewId === it.id ? 'Hide' : 'View content'}
                    </button>
                  </label>
                  {previewId === it.id && (
                    <div className="px-2.5 pb-2">
                      <InlineContentPreview headers={headers} assetId={it.id} theme={theme} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px]" style={{ color: theme.textMuted }}>{selected.size} selected</span>
            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
              style={{ backgroundColor: PRIMARY_BLUE }}
            >
              {importing ? 'Importing…' : `Add ${selected.size || ''} to library`}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function InlineContentPreview({ headers, assetId, theme }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    axios.get(`/api/script-assets/${assetId}/content`, { headers })
      .then(res => { if (!cancelled) setContent(res.data?.content || '(empty)'); })
      .catch(err => { if (!cancelled) setError(err.response?.data?.detail || err.message || 'Could not load content'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);
  if (error) return <p className="text-[10px]" style={{ color: DANGER }}>{error}</p>;
  if (content === null) return <p className="text-[10px]" style={{ color: theme.textMuted }}>Loading…</p>;
  return (
    <pre className="text-[10px] font-mono p-2 rounded-lg overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap" style={{ backgroundColor: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}>{content}</pre>
  );
}

// ── External Git script repo browser / importer ──
export function ScriptRepoModal({ theme, headers, onClose, onImported }) {
  const [repos, setRepos] = useState(null);
  const [activeRepoId, setActiveRepoId] = useState(null);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: '', owner: '', repo: '', branch: 'main', path: '' });

  function loadRepos() {
    axios.get('/api/script-repos', { headers }).then(res => setRepos(res.data.items || [])).catch(() => setRepos([]));
  }
  useEffect(() => { loadRepos(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function browse(repoId, atPath) {
    setActiveRepoId(repoId);
    setEntries(null);
    setError(null);
    setSelected(new Set());
    axios.get(`/api/script-repos/${repoId}/browse`, { headers, params: atPath !== undefined ? { path: atPath } : {} })
      .then(res => { setEntries(res.data.items || []); setPath(res.data.path || ''); })
      .catch(err => { setEntries([]); setError(err.response?.data?.detail || err.message || 'Could not browse this repo'); });
  }

  async function handleAddRepo() {
    if (!newRepo.name.trim() || !newRepo.owner.trim() || !newRepo.repo.trim()) return;
    const res = await axios.post('/api/script-repos', newRepo, { headers });
    setShowAddForm(false);
    setNewRepo({ name: '', owner: '', repo: '', branch: 'main', path: '' });
    loadRepos();
    browse(res.data.id, res.data.path || '');
  }

  async function handleRemoveRepo(id) {
    if (!confirm('Disconnect this repo?')) return;
    await axios.delete(`/api/script-repos/${id}`, { headers });
    if (activeRepoId === id) { setActiveRepoId(null); setEntries(null); }
    loadRepos();
  }

  function quickAddApplivery() {
    setNewRepo({ name: 'Applivery official scripts', owner: 'applivery', repo: 'applivery-mdm-scripts', branch: 'main', path: '' });
    setShowAddForm(true);
  }

  function toggle(item) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(item.path) ? next.delete(item.path) : next.add(item.path);
      return next;
    });
  }

  async function handleImport() {
    const files = (entries || []).filter(e => selected.has(e.path)).map(e => ({ name: e.name, path: e.path, downloadUrl: e.downloadUrl, inferredPlatform: e.inferredPlatform }));
    if (!files.length) return;
    setImporting(true);
    try {
      const res = await axios.post('/api/script-repos/import', { repoId: activeRepoId, files }, { headers });
      setImportResult(res.data);
      if (onImported) onImported();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const pathParts = path ? path.split('/').filter(Boolean) : [];

  return (
    <ModalShell theme={theme} title="Import scripts from a Git repo" subtitle="Browse a connected repo of script files and add selected ones to Applivery + the library." onClose={onClose} width={700}>
      {importResult ? (
        <div className="space-y-2">
          <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: PRIMARY_BLUE }}>
            <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> Imported {importResult.imported.length} script{importResult.imported.length === 1 ? '' : 's'}.
          </p>
          {importResult.failed.length > 0 && (
            <div className="text-xs" style={{ color: WARNING }}>
              {importResult.failed.length} failed:
              <ul className="mt-1 space-y-0.5">
                {importResult.failed.map((f, i) => <li key={i} className="text-[10px]">"{f.name}" — {f.error}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1" style={{ backgroundColor: PRIMARY_BLUE }}>Done</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[160px_1fr] gap-3">
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Connected repos</p>
            {repos === null ? (
              <p className="text-[10px]" style={{ color: theme.textMuted }}>Loading…</p>
            ) : repos.length === 0 ? (
              <p className="text-[10px]" style={{ color: theme.textMuted }}>None yet.</p>
            ) : (
              repos.map(r => (
                <div key={r.id} className="flex items-center gap-1">
                  <button
                    onClick={() => browse(r.id)}
                    className="flex-1 text-left px-2 py-1.5 rounded-lg text-[11px] truncate"
                    style={{ backgroundColor: activeRepoId === r.id ? `${PRIMARY_BLUE}12` : 'transparent', color: activeRepoId === r.id ? PRIMARY_BLUE : theme.text }}
                  >
                    {r.name}
                  </button>
                  <button onClick={() => handleRemoveRepo(r.id)} className="p-1 rounded shrink-0" style={{ color: DANGER }}><Trash2 size={11} /></button>
                </div>
              ))
            )}
            <button onClick={quickAddApplivery} className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] border border-dashed hover:bg-blue-500/10" style={{ borderColor: theme.border, color: theme.textMuted }}>
              <Plus size={11} /> Applivery's repo
            </button>
            <button onClick={() => setShowAddForm(v => !v)} className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] border border-dashed hover:bg-blue-500/10" style={{ borderColor: theme.border, color: theme.textMuted }}>
              <LinkIcon size={11} /> Custom repo…
            </button>
            {showAddForm && (
              <div className="space-y-1.5 p-2 rounded-lg border" style={{ borderColor: theme.border }}>
                {['name', 'owner', 'repo', 'branch', 'path'].map(k => (
                  <input
                    key={k}
                    value={newRepo[k]}
                    onChange={(e) => setNewRepo(prev => ({ ...prev, [k]: e.target.value }))}
                    placeholder={k === 'path' ? 'path (optional)' : k}
                    className="w-full px-2 py-1 rounded text-[10px] outline-none"
                    style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text }}
                  />
                ))}
                <button onClick={handleAddRepo} className="w-full px-2 py-1 rounded text-[10px] font-semibold text-white" style={{ backgroundColor: PRIMARY_BLUE }}>Connect</button>
              </div>
            )}
          </div>

          <div>
            {!activeRepoId ? (
              <p className="text-xs" style={{ color: theme.textMuted }}>Select a repo to browse.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-[10px] flex-wrap" style={{ color: theme.textMuted }}>
                  <button onClick={() => browse(activeRepoId, '')} className="flex items-center gap-0.5 hover:underline"><Folder size={10} /> root</button>
                  {pathParts.map((p, i) => (
                    <React.Fragment key={i}>
                      <span>/</span>
                      <button onClick={() => browse(activeRepoId, pathParts.slice(0, i + 1).join('/'))} className="hover:underline">{p}</button>
                    </React.Fragment>
                  ))}
                </div>
                {error && (
                  <p className="inline-flex items-start gap-1.5 text-xs" style={{ color: DANGER }}>
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
                  </p>
                )}
                {entries === null ? (
                  <p className="text-xs" style={{ color: theme.textMuted }}>Loading…</p>
                ) : entries.length === 0 ? (
                  <p className="text-xs" style={{ color: theme.textMuted }}>Empty directory.</p>
                ) : (
                  <div className="rounded-lg border max-h-72 overflow-y-auto divide-y" style={{ borderColor: theme.border }}>
                    {entries.map(e => (
                      <div key={e.path} className="flex items-center gap-2 px-2.5 py-1.5">
                        {e.type === 'dir' ? (
                          <button onClick={() => browse(activeRepoId, e.path)} className="flex items-center gap-2 flex-1 text-left text-xs hover:underline" style={{ color: theme.text }}>
                            <Folder size={13} style={{ color: theme.textMuted }} /> {e.name}
                          </button>
                        ) : (
                          <label className="flex items-center gap-2 flex-1 text-xs cursor-pointer" style={{ color: e.importable ? theme.text : theme.textMuted }}>
                            <input type="checkbox" checked={selected.has(e.path)} onChange={() => toggle(e)} disabled={!e.importable} />
                            <FileCode2 size={13} style={{ color: theme.textMuted }} />
                            <span className="truncate flex-1">{e.name}</span>
                            {e.inferredPlatform && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-light border border-current/25" style={{ backgroundColor: `${theme.textMuted}15`, color: theme.textMuted }}>{PLATFORM_LABELS[e.inferredPlatform]}</span>
                            )}
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px]" style={{ color: theme.textMuted }}>{selected.size} selected</span>
                  <button
                    onClick={handleImport}
                    disabled={importing || selected.size === 0}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
                    style={{ backgroundColor: PRIMARY_BLUE }}
                  >
                    {importing ? 'Importing…' : `Import ${selected.size || ''}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
