import crypto from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { liveCacheGet, liveCacheSet } from "../../services/liveCache";
import { THREAT_INTEL_PROVIDER_TYPES, type ThreatIntelProviderPayload, type ThreatIntelResult } from "./threatIntel.schemas";

/**
 * Threat Intel Providers CRUD + IOC extraction/lookup dispatch. Port of
 * main.py:13960-14330 (`_load_threat_intel_providers` through `enrich_case`).
 */

const THREAT_INTEL_SECRET_FIELDS: Record<string, readonly string[]> = {
  virustotal: ["apiKey"], abuseipdb: ["apiKey"], hibp: ["apiKey"],
};

// Which IOC types each provider type can look up — main.py's
// THREAT_INTEL_PROVIDER_IOC_SUPPORT (main.py:13968-13977).
const THREAT_INTEL_PROVIDER_IOC_SUPPORT: Record<string, readonly string[]> = {
  virustotal: ["ip", "domain", "md5", "sha1", "sha256", "url"],
  abuseipdb: ["ip"],
  hibp: ["email"],
  generic_rest: ["ip", "domain", "md5", "sha1", "sha256", "url", "unknown"],
};

function encryptThreatIntelConfig(type: string, config: Record<string, any>): Record<string, any> {
  const out = { ...(config ?? {}) };
  for (const field of THREAT_INTEL_SECRET_FIELDS[type] ?? []) {
    if (out[field]) out[field] = encryptSecret(String(out[field]));
  }
  return out;
}

function decryptThreatIntelConfig(type: string, config: Record<string, any>): Record<string, any> {
  const out = { ...(config ?? {}) };
  for (const field of THREAT_INTEL_SECRET_FIELDS[type] ?? []) {
    if (out[field]) {
      try {
        out[field] = decryptSecret(String(out[field]));
      } catch {
        // foreign/malformed value — leave as-is, same fail-open trade-off as elsewhere
      }
    }
  }
  return out;
}

function serializeProvider(row: { id: string; workspaceSlug: string; name: string; type: string; enabled: boolean; config: unknown; createdBy: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    id: row.id, name: row.name, type: row.type, enabled: row.enabled,
    config: decryptThreatIntelConfig(row.type, (row.config as Record<string, any>) ?? {}),
    createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listThreatIntelProviders(workspaceSlug: string) {
  const rows = await prisma.threatIntelProvider.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
  return { items: rows.map(serializeProvider) };
}

function validateProviderPayload(payload: ThreatIntelProviderPayload) {
  if (!(THREAT_INTEL_PROVIDER_TYPES as readonly string[]).includes(payload.type)) {
    throw new HttpError(400, `type must be one of ${JSON.stringify(THREAT_INTEL_PROVIDER_TYPES)}`);
  }
}

export async function createThreatIntelProvider(workspaceSlug: string, payload: ThreatIntelProviderPayload, actorEmail: string) {
  validateProviderPayload(payload);
  const created = await prisma.threatIntelProvider.create({
    data: { workspaceSlug, name: payload.name, type: payload.type, enabled: payload.enabled, config: encryptThreatIntelConfig(payload.type, payload.config), createdBy: actorEmail },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "threat_intel", action: "threat_intel_provider_created", actor: actorEmail,
    targetType: "threat_intel_provider", targetId: created.id, targetName: created.name,
    message: `Threat intel provider "${created.name}" (${created.type}) created by ${actorEmail}`,
  });
  return serializeProvider(created);
}

export async function updateThreatIntelProvider(workspaceSlug: string, providerId: string, payload: ThreatIntelProviderPayload, actorEmail: string) {
  validateProviderPayload(payload);
  const existing = await prisma.threatIntelProvider.findFirst({ where: { workspaceSlug, id: providerId } });
  if (!existing) throw new HttpError(404, "Provider not found");
  const updated = await prisma.threatIntelProvider.update({
    where: { id: providerId },
    data: { name: payload.name, type: payload.type, enabled: payload.enabled, config: encryptThreatIntelConfig(payload.type, payload.config) },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "threat_intel", action: "threat_intel_provider_updated", actor: actorEmail,
    targetType: "threat_intel_provider", targetId: providerId, targetName: updated.name,
    message: `Threat intel provider "${updated.name}" updated by ${actorEmail}`,
  });
  return serializeProvider(updated);
}

export async function deleteThreatIntelProvider(workspaceSlug: string, providerId: string, actorEmail: string) {
  const existing = await prisma.threatIntelProvider.findFirst({ where: { workspaceSlug, id: providerId } });
  if (!existing) throw new HttpError(404, "Provider not found");
  await prisma.threatIntelProvider.delete({ where: { id: providerId } });
  await recordAuditEvent(workspaceSlug, {
    category: "threat_intel", action: "threat_intel_provider_deleted", actor: actorEmail, severity: "warning",
    targetType: "threat_intel_provider", targetId: providerId, targetName: existing.name,
    message: `Threat intel provider "${existing.name}" deleted by ${actorEmail}`,
  });
  return { status: "ok" };
}

// ── IOC extraction/detection (main.py:14001-14052) ──

const IOC_SCAN_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s"'<>]+/g,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  /\b[a-fA-F0-9]{64}\b/g,
  /\b[a-fA-F0-9]{40}\b/g,
  /\b[a-fA-F0-9]{32}\b/g,
  /\b[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}\b/g, // email — before the domain pattern, else "user@" is discarded and only the domain half matches
  /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g,
];

/** Port of `_extract_ioc_candidates` (main.py:14011-14034). */
export function extractIocCandidates(text: string, limit = 3): string[] {
  const found: string[] = [];
  const claimedSpans: Array<[number, number]> = [];
  for (const pattern of IOC_SCAN_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text ?? "")) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (claimedSpans.some(([s, e]) => start < e && s < end)) continue;
      const value = m[0].replace(/[.,;:)]+$/, "");
      if (value && !found.includes(value)) {
        found.push(value);
        claimedSpans.push([start, end]);
      }
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/** Port of `_detect_ioc_type` (main.py:14036-14052). */
export function detectIocType(value: string): string {
  const v = (value ?? "").trim();
  if (/^https?:\/\//i.test(v)) return "url";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return "ip";
  if (/^[a-fA-F0-9]{64}$/.test(v)) return "sha256";
  if (/^[a-fA-F0-9]{40}$/.test(v)) return "sha1";
  if (/^[a-fA-F0-9]{32}$/.test(v)) return "md5";
  if (/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v)) return "email";
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v) && !v.includes(" ")) return "domain";
  return "unknown";
}

// ── Per-provider lookups (main.py:14054-14159) ──

async function lookupVirustotal(cfg: Record<string, any>, iocType: string, iocValue: string) {
  const apiKey = cfg.apiKey;
  if (!apiKey) throw new Error("VirusTotal integration is missing an API key");
  const headers = { "x-apikey": apiKey };
  let endpoint: string, guiPath: string;
  if (iocType === "ip") { endpoint = `ip_addresses/${iocValue}`; guiPath = `ip-address/${iocValue}`; }
  else if (iocType === "domain") { endpoint = `domains/${iocValue}`; guiPath = `domain/${iocValue}`; }
  else if (iocType === "md5" || iocType === "sha1" || iocType === "sha256") { endpoint = `files/${iocValue}`; guiPath = `file/${iocValue}`; }
  else if (iocType === "url") {
    const urlId = Buffer.from(iocValue).toString("base64url").replace(/=+$/, "");
    endpoint = `urls/${urlId}`; guiPath = `url/${urlId}`;
  } else throw new Error(`VirusTotal doesn't support IOC type '${iocType}'`);

  const res = await fetch(`https://www.virustotal.com/api/v3/${endpoint}`, { headers });
  if (res.status === 404) return { verdict: "unknown", score: null, detail: "Not found in VirusTotal's dataset", link: `https://www.virustotal.com/gui/${guiPath}` };
  if (!res.ok) throw new Error(`VirusTotal returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  const stats = data?.data?.attributes?.last_analysis_stats ?? {};
  const malicious = stats.malicious ?? 0;
  const suspicious = stats.suspicious ?? 0;
  const total = Object.values(stats).reduce((a: number, b: any) => a + (Number(b) || 0), 0) || 1;
  const verdict = malicious > 0 ? "malicious" : suspicious > 0 ? "suspicious" : "clean";
  return { verdict, score: malicious, detail: `${malicious}/${total} engines flagged malicious, ${suspicious} suspicious`, link: `https://www.virustotal.com/gui/${guiPath}` };
}

async function lookupAbuseipdb(cfg: Record<string, any>, iocValue: string) {
  const apiKey = cfg.apiKey;
  if (!apiKey) throw new Error("AbuseIPDB integration is missing an API key");
  const headers = { Key: apiKey, Accept: "application/json" };
  const res = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(iocValue)}&maxAgeInDays=90`, { headers });
  if (!res.ok) throw new Error(`AbuseIPDB returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  const score = data?.data?.abuseConfidenceScore ?? 0;
  const verdict = score >= 75 ? "malicious" : score >= 25 ? "suspicious" : "clean";
  const reports = data?.data?.totalReports ?? 0;
  return { verdict, score, detail: `Abuse confidence ${score}/100 from ${reports} report${reports !== 1 ? "s" : ""}`, link: `https://www.abuseipdb.com/check/${iocValue}` };
}

async function lookupHibp(cfg: Record<string, any>, iocValue: string) {
  const apiKey = cfg.apiKey;
  if (!apiKey) throw new Error("Have I Been Pwned integration is missing an API key");
  const headers = { "hibp-api-key": apiKey, "User-Agent": "Applivery-SOAR" };
  const res = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(iocValue)}?truncateResponse=false`, { headers });
  if (res.status === 404) return { verdict: "clean", score: 0, detail: "Not found in any known breach", link: "https://haveibeenpwned.com/" };
  if (res.status === 429) throw new Error("Have I Been Pwned rate limit hit — its API is throttled per API-key subscription tier");
  if (!res.ok) throw new Error(`Have I Been Pwned returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const breaches = ((await res.json()) as any[]) ?? [];
  const breachNames = breaches.map((b) => b.Name || b.Title || "Unknown breach");
  const hasPasswordExposure = breaches.some((b) => (b.DataClasses ?? []).includes("Passwords"));
  const verdict = hasPasswordExposure ? "malicious" : breaches.length ? "suspicious" : "clean";
  const nameList = breachNames.slice(0, 5).join(", ") + (breachNames.length > 5 ? "…" : "");
  return {
    verdict, score: breaches.length,
    detail: `Found in ${breaches.length} breach${breaches.length !== 1 ? "es" : ""}: ${nameList}` + (hasPasswordExposure ? " (includes exposed passwords)" : ""),
    link: "https://haveibeenpwned.com/",
  };
}

async function lookupGenericRest(cfg: Record<string, any>, iocValue: string) {
  const template = cfg.urlTemplate;
  if (!template) throw new Error("No URL template configured");
  const encoded = encodeURIComponent(iocValue);
  const url = String(template).replace("{{ ioc }}", encoded).replace("{{ioc}}", encoded);
  const res = await fetch(url, { headers: cfg.headers ?? {} });
  if (!res.ok) throw new Error(`Provider returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return { verdict: "unknown", score: null, detail: text.slice(0, 300), link: null };
}

const THREAT_INTEL_CACHE_TTL_SECONDS = 6 * 3600; // 6 hours

/**
 * Runs `iocValue` against every enabled provider that supports its detected
 * type, in parallel. One provider failing doesn't stop the others. Results
 * are cached for THREAT_INTEL_CACHE_TTL_SECONDS; `useCache=false` bypasses
 * this for an explicit force re-check. Port of `_run_threat_intel_lookup`
 * (main.py:14163-14226).
 */
export async function runThreatIntelLookup(workspaceSlug: string, iocValue: string, actor: string | null, useCache = true): Promise<ThreatIntelResult[]> {
  const iocType = detectIocType(iocValue);
  const cacheKey = `threat_intel:${iocType}:${iocValue.toLowerCase()}`;
  if (useCache) {
    const cached = liveCacheGet<ThreatIntelResult[]>(workspaceSlug, cacheKey);
    if (cached !== null) {
      return cached.map((r) => ({ ...r, id: crypto.randomUUID(), checkedBy: actor, cached: true }));
    }
  }

  const allProviders = await prisma.threatIntelProvider.findMany({ where: { workspaceSlug } });
  const providers = allProviders
    .filter((p) => p.enabled && (THREAT_INTEL_PROVIDER_IOC_SUPPORT[p.type] ?? []).includes(iocType))
    .map((p) => ({ ...p, config: decryptThreatIntelConfig(p.type, (p.config as Record<string, any>) ?? {}) }));
  const nowIso = new Date().toISOString();

  const runOne = async (provider: (typeof providers)[number]): Promise<ThreatIntelResult> => {
    const entry: ThreatIntelResult = {
      id: crypto.randomUUID(), ioc: iocValue, iocType, provider: provider.name, providerType: provider.type,
      verdict: "unknown", score: null, detail: "", link: null, checkedAt: nowIso, checkedBy: actor, cached: false,
    };
    try {
      let result: { verdict: string; score: number | null; detail: string; link: string | null };
      if (provider.type === "virustotal") result = await lookupVirustotal(provider.config, iocType, iocValue);
      else if (provider.type === "abuseipdb") result = await lookupAbuseipdb(provider.config, iocValue);
      else if (provider.type === "hibp") result = await lookupHibp(provider.config, iocValue);
      else result = await lookupGenericRest(provider.config, iocValue);
      Object.assign(entry, result);
    } catch (e) {
      entry.verdict = "error"; entry.score = null; entry.detail = String(e instanceof Error ? e.message : e).slice(0, 300); entry.link = null;
    }
    return entry;
  };

  const results = await Promise.all(providers.map(runOne));

  if (results.length) liveCacheSet(workspaceSlug, cacheKey, results, THREAT_INTEL_CACHE_TTL_SECONDS);

  if (iocType === "unknown" && providers.length === 0) {
    results.push({
      id: crypto.randomUUID(), ioc: iocValue, iocType: "unknown", provider: null, providerType: null,
      verdict: "unknown", score: null,
      detail: "Couldn't classify this value as an IP, domain, URL, or file hash — no provider was queried",
      link: null, checkedAt: nowIso, checkedBy: actor, cached: false,
    });
  }
  return results;
}

const TEST_LOOKUP_TARGETS: Record<string, string> = {
  virustotal: "8.8.8.8", abuseipdb: "8.8.8.8", generic_rest: "8.8.8.8",
  hibp: "account-exists@hibp-integration-tests.com", // HIBP's own official test account — always returns a fixed set of breaches
};

export async function testThreatIntelProvider(workspaceSlug: string, providerId: string) {
  const row = await prisma.threatIntelProvider.findFirst({ where: { workspaceSlug, id: providerId } });
  if (!row) throw new HttpError(404, "Provider not found");
  const cfg = decryptThreatIntelConfig(row.type, (row.config as Record<string, any>) ?? {});
  try {
    let result;
    if (row.type === "virustotal") result = await lookupVirustotal(cfg, "ip", TEST_LOOKUP_TARGETS.virustotal);
    else if (row.type === "abuseipdb") result = await lookupAbuseipdb(cfg, TEST_LOOKUP_TARGETS.abuseipdb);
    else if (row.type === "hibp") result = await lookupHibp(cfg, TEST_LOOKUP_TARGETS.hibp);
    else if (row.type === "generic_rest") result = await lookupGenericRest(cfg, TEST_LOOKUP_TARGETS.generic_rest);
    else throw new Error(`Unknown provider type '${row.type}'`);
    return { status: "ok", result };
  } catch (e) {
    throw new HttpError(400, `Test failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
