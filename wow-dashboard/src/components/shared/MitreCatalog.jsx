import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Magnifer as Search } from '@solar-icons/react';

// Shared MITRE ATT&CK catalog fetch + tag picker/pill display — used by
// PolicyBuilder (tag a policy with the techniques it detects) and CasesView
// (inherited tags shown/editable on the resulting Case). Catalog comes from
// GET /api/mitre/techniques (see MITRE_TECHNIQUES/MITRE_TACTICS in main.py) —
// fetched once per mounting component via this hook rather than duplicated
// inline, so both call sites stay in sync with the backend catalog for free.

// One color per tactic, cycling through a fixed palette in ATT&CK's usual
// left-to-right (recon → impact) order — purely a visual grouping aid.
const TACTIC_PALETTE = [
  '#0241E3', '#7C3AED', '#DB2777', '#EF4444', '#F97316', '#F59E0B',
  '#EAB308', '#84CC16', '#22C55E', '#14B8A6', '#0EA5E9', '#6366F1',
];

export function useMitreCatalog(apiToken, orgSlug) {
  const [techniques, setTechniques] = useState([]);
  const [tactics, setTactics] = useState([]);
  // Freshness signal for the curated list's live cross-check against
  // MITRE's own STIX feed — see GET /api/mitre/techniques and
  // mitre_catalog_refresh_loop in main.py. null until the first fetch
  // resolves; catalogLastFetchedAt stays null forever if the background
  // refresher has never succeeded (e.g. no outbound network to GitHub),
  // in which case every technique below just falls back to its static
  // curated name — never a hard failure, only reduced freshness.
  const [catalogMeta, setCatalogMeta] = useState({ lastFetchedAt: null, lastError: null, techniqueCount: 0 });

  const headers = { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug };

  const refetch = () => {
    if (!apiToken || !orgSlug) return;
    axios.get('/api/mitre/techniques', { headers })
      .then(res => {
        setTechniques(res.data?.items || []);
        setTactics(res.data?.tactics || []);
        setCatalogMeta({
          lastFetchedAt: res.data?.catalogLastFetchedAt || null,
          lastError: res.data?.catalogLastError || null,
          techniqueCount: res.data?.catalogTechniqueCount || 0,
        });
      })
      .catch(() => {});
  };

  useEffect(refetch, [apiToken, orgSlug]);

  const refreshCatalogNow = async () => {
    if (!apiToken || !orgSlug) return;
    await axios.post('/api/mitre/refresh', {}, { headers }).catch(() => {});
    refetch();
  };

  const tacticColor = useMemo(() => {
    const map = {};
    tactics.forEach((t, i) => { map[t.key] = TACTIC_PALETTE[i % TACTIC_PALETTE.length]; });
    return map;
  }, [tactics]);

  const techniqueById = useMemo(() => {
    const map = {};
    techniques.forEach(t => { map[t.id] = t; });
    return map;
  }, [techniques]);

  return { techniques, tactics, tacticColor, techniqueById, catalogMeta, refreshCatalogNow };
}

// Small read-only pills for a list of technique ids — degrades gracefully
// (just shows the raw id) if the catalog hasn't loaded yet or the id is
// unrecognized (e.g. a technique later removed from the curated list).
export function MitreTagPills({ ids, techniqueById, tacticColor, size = 'sm' }) {
  if (!ids || ids.length === 0) return null;
  const cls = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map(id => {
        const tech = techniqueById?.[id];
        const color = tech ? (tacticColor?.[tech.tactic] || '#64748B') : '#94A3B8';
        return (
          <span
            key={id}
            title={tech ? `${tech.name} (${tech.tactic.replace(/-/g, ' ')})` : id}
            className={`inline-flex items-center rounded-full font-semibold ${cls}`}
            style={{ backgroundColor: `${color}15`, color }}
          >
            {id}
          </span>
        );
      })}
    </div>
  );
}

function timeAgo(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Checkbox picker grouped by tactic, with a name/id search filter — used
// wherever technique ids need to be edited (PolicyBuilder, Case detail).
// catalogMeta/onRefreshCatalog are optional (from useMitreCatalog) — when
// given, a small freshness footer shows when the curated list was last
// cross-checked against MITRE's live feed, since that's exactly the "did
// this quietly go stale" signal that used to not exist at all.
export function MitreTagPicker({ techniques, tactics, tacticColor, selected, onChange, theme, catalogMeta, onRefreshCatalog }) {
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    if (!onRefreshCatalog) return;
    setRefreshing(true);
    try { await onRefreshCatalog(); } finally { setRefreshing(false); }
  }

  const bySearch = useMemo(() => {
    if (!search.trim()) return techniques;
    const term = search.trim().toLowerCase();
    return techniques.filter(t => t.id.toLowerCase().includes(term) || t.name.toLowerCase().includes(term));
  }, [techniques, search]);

  const grouped = useMemo(() => {
    const byTactic = {};
    bySearch.forEach(t => { (byTactic[t.tactic] = byTactic[t.tactic] || []).push(t); });
    return tactics
      .map(tac => ({ ...tac, techniques: byTactic[tac.key] || [] }))
      .filter(tac => tac.techniques.length > 0);
  }, [bySearch, tactics]);

  function toggle(id) {
    const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
    onChange(next);
  }

  return (
    <div className="rounded-lg" style={{ border: `1px solid ${theme.border}` }}>
      <div className="p-2 flex items-center gap-2" style={{ borderBottom: `1px solid ${theme.border}` }}>
        <Search size={12} style={{ color: theme.textMuted }} className="shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter techniques…"
          className="flex-1 text-xs outline-none bg-transparent"
          style={{ color: theme.text }}
        />
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-[10px] font-semibold shrink-0" style={{ color: theme.textMuted }}>
            Clear ({selected.length})
          </button>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto p-2 space-y-2">
        {grouped.map(tac => (
          <div key={tac.key}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 px-1" style={{ color: tacticColor[tac.key] || theme.textMuted }}>{tac.name}</p>
            <div className="space-y-0.5">
              {tac.techniques.map(t => (
                <label key={t.id} className="flex items-center gap-2 px-1.5 py-1 rounded-md text-xs cursor-pointer" style={{ backgroundColor: selected.includes(t.id) ? theme.bg : 'transparent' }}>
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                  <span className="font-mono text-[10px] shrink-0" style={{ color: theme.textMuted }}>{t.id}</span>
                  <span style={{ color: t.revoked ? '#EF4444' : theme.text, textDecoration: t.revoked ? 'line-through' : 'none' }}>{t.name}</span>
                  {t.revoked && (
                    <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full shrink-0" style={{ backgroundColor: '#EF444415', color: '#EF4444' }} title="MITRE has revoked this technique ID upstream — kept selectable only so existing tags on old Policies/Cases still render, but shouldn't be applied to new ones.">
                      revoked
                    </span>
                  )}
                  {!t.revoked && t.deprecated && (
                    <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full shrink-0" style={{ backgroundColor: '#F59E0B15', color: '#F59E0B' }} title="MITRE has deprecated this technique ID upstream, usually in favor of a newer/more specific one.">
                      deprecated
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && <p className="text-xs text-center py-4" style={{ color: theme.textMuted }}>No techniques match "{search}"</p>}
      </div>
      {catalogMeta && (
        <div className="px-2 py-1.5 flex items-center justify-between gap-2 text-[10px]" style={{ borderTop: `1px solid ${theme.border}`, color: theme.textMuted }}>
          <span>
            {catalogMeta.lastFetchedAt
              ? `Cross-checked against MITRE's live catalog ${timeAgo(catalogMeta.lastFetchedAt)} (${catalogMeta.techniqueCount} techniques)`
              : catalogMeta.lastError
                ? `Live sync unavailable (${catalogMeta.lastError}) — showing curated names only`
                : 'Not yet cross-checked against MITRE\'s live catalog — showing curated names only'}
          </span>
          {onRefreshCatalog && (
            <button type="button" onClick={handleRefresh} disabled={refreshing} className="font-semibold shrink-0 disabled:opacity-50" style={{ color: theme.text }}>
              {refreshing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
