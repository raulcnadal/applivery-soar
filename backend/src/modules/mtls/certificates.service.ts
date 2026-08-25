import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { formatThumbprint, getCertificateThumbprintHex } from "../../utils/mtlsPki";

/**
 * Issued device certificates — the fleet-migration/status dashboard an admin
 * uses to know when it's safe to flip the cutover, and the table
 * verifyMtlsIdentity (middleware/mtlsIdentity.middleware.ts) consults on
 * every mTLS-gated request.
 */

export interface CertificateStatus {
  id: string;
  serialNumber: string;
  serialHex: string;
  thumbprint: string | null;
  status: "active" | "expiring-soon" | "expired" | "revoked" | "superseded";
  notBefore: string;
  notAfter: string;
  supersededAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  issuedAt: string;
  deviceId: string | null;
  deviceDisplayName: string | null;
  employeeName: string | null;
}

const EXPIRING_SOON_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — a coarse dashboard signal, independent of any given CA's configured renewal-trigger fraction

function computeStatus(row: { notAfter: Date; supersededAt: Date | null; revokedAt: Date | null }): CertificateStatus["status"] {
  if (row.revokedAt) return "revoked";
  if (row.supersededAt) return "superseded";
  const now = Date.now();
  if (row.notAfter.getTime() < now) return "expired";
  if (row.notAfter.getTime() - now < EXPIRING_SOON_WINDOW_MS) return "expiring-soon";
  return "active";
}

/**
 * Matches each issued certificate's serial number (the device's own
 * Applivery serial, not the certificate's X.509 serial) against the live
 * fleet to show a real device name and assigned employee instead of a bare
 * serial number. `authorization` is optional and this match is entirely
 * best-effort: a missing/failed live lookup (no Automation Credential yet, a
 * transient API error) just falls back to showing the serial number alone —
 * it never blocks the certificate list itself from loading.
 */
async function matchDevicesBySerial(workspaceSlug: string, authorization: string | undefined): Promise<Map<string, { id: string; displayName: string | null; employeeName: string | null }>> {
  const matches = new Map<string, { id: string; displayName: string | null; employeeName: string | null }>();
  if (!authorization) return matches;
  try {
    const { getDevicesFull } = await import("../devices/devices.service");
    const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
    for (const d of devicesResp.items) {
      if (!d.serialNumber) continue;
      const mdmUser = d.mdmUser as { name?: string; email?: string } | null;
      matches.set(d.serialNumber, { id: d.id, displayName: d.displayName ?? null, employeeName: mdmUser?.name || mdmUser?.email || null });
    }
  } catch {
    /* best-effort — see doc comment above */
  }
  return matches;
}

export interface ListCertificatesOptions {
  /** "active" = revokedAt IS NULL (includes expiring-soon/expired/superseded sub-statuses); "revoked" = revokedAt IS NOT NULL. Matches the two-section split in the Issued Device Certificates panel. */
  status: "active" | "revoked";
  /** Matched against serial number, the cert's own X.509 serial (hex), and its SHA-256 thumbprint (with or without colons — normalized before querying). */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListCertificatesResult {
  items: CertificateStatus[];
  total: number;
}

const CERT_LIST_DEFAULT_LIMIT = 50;
const CERT_LIST_MAX_LIMIT = 200;

/** Strips everything but hex characters and uppercases — same normalization on both the write side (thumbprintHex column) and a pasted search term, so "ab:12:cd" and "AB12CD" match the same stored row via a plain `contains`. */
export function normalizeHexSearch(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export function buildCertificatesWhere(workspaceSlug: string, options: Pick<ListCertificatesOptions, "status" | "search">) {
  const where: Record<string, unknown> = {
    workspaceSlug,
    revokedAt: options.status === "revoked" ? { not: null } : null,
  };
  const search = options.search?.trim();
  if (search) {
    const hexSearch = normalizeHexSearch(search);
    const or: Record<string, unknown>[] = [
      { serialNumber: { contains: search, mode: "insensitive" } },
      { serialHex: { contains: search, mode: "insensitive" } },
    ];
    // Only add the thumbprint branch when there's actually a hex-ish
    // substring to look for — an all-punctuation/whitespace search (or one
    // that's just device-name-ish text with no hex in it) would otherwise
    // turn into `contains: ""`, matching every row and defeating the filter.
    if (hexSearch) or.push({ thumbprintHex: { contains: hexSearch } });
    where.OR = or;
  }
  return where;
}

/** Backfills thumbprintHex for any row in this page still missing it (issued before the column existed) — computed from the already-stored certPem, persisted once, never recomputed again. Best-effort: a PEM that fails to parse just stays null (matches getCertificateThumbprintHex's own null-on-failure contract) rather than blocking the list. */
async function backfillThumbprints(rows: Array<{ id: string; certPem: string; thumbprintHex: string | null }>): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  await Promise.all(
    rows.map(async (row) => {
      if (row.thumbprintHex) {
        result.set(row.id, row.thumbprintHex);
        return;
      }
      const hex = await getCertificateThumbprintHex(row.certPem);
      result.set(row.id, hex);
      if (hex) {
        await prisma.deviceCertificate.update({ where: { id: row.id }, data: { thumbprintHex: hex } }).catch(() => {
          /* best-effort backfill — a lost race with a concurrent request or revoke isn't worth failing the list over */
        });
      }
    }),
  );
  return result;
}

export async function listCertificates(workspaceSlug: string, options: ListCertificatesOptions, authorization?: string): Promise<ListCertificatesResult> {
  const where = buildCertificatesWhere(workspaceSlug, options);
  const take = Math.max(1, Math.min(options.limit || CERT_LIST_DEFAULT_LIMIT, CERT_LIST_MAX_LIMIT));
  const skip = Math.max(0, options.offset || 0);

  const [rows, total] = await Promise.all([
    prisma.deviceCertificate.findMany({ where, orderBy: { issuedAt: "desc" }, skip, take }),
    prisma.deviceCertificate.count({ where }),
  ]);

  const [deviceBySerial, thumbprintById] = await Promise.all([
    matchDevicesBySerial(workspaceSlug, authorization),
    backfillThumbprints(rows),
  ]);

  const items = rows.map((row: (typeof rows)[number]) => {
    const device = deviceBySerial.get(row.serialNumber) ?? null;
    return {
      id: row.id,
      serialNumber: row.serialNumber,
      serialHex: row.serialHex,
      thumbprint: formatThumbprint(thumbprintById.get(row.id) ?? null),
      status: computeStatus(row),
      notBefore: row.notBefore.toISOString(),
      notAfter: row.notAfter.toISOString(),
      supersededAt: row.supersededAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedReason: row.revokedReason,
      issuedAt: row.issuedAt.toISOString(),
      deviceId: device?.id ?? null,
      deviceDisplayName: device?.displayName ?? null,
      employeeName: device?.employeeName ?? null,
    };
  });

  return { items, total };
}

/** Cheap counts backing the panel's section headers ("Active (1,204)" / "Revoked (38)") — two indexed `count()`s instead of loading every row, so this stays fast at fleet scale. */
export async function getCertificateCounts(workspaceSlug: string): Promise<{ active: number; revoked: number }> {
  const [active, revoked] = await Promise.all([
    prisma.deviceCertificate.count({ where: { workspaceSlug, revokedAt: null } }),
    prisma.deviceCertificate.count({ where: { workspaceSlug, revokedAt: { not: null } } }),
  ]);
  return { active, revoked };
}

export async function issueCertificateRecord(params: {
  workspaceSlug: string;
  serialNumber: string;
  serialHex: string;
  certPem: string;
  notBefore: Date;
  notAfter: Date;
}): Promise<void> {
  const thumbprintHex = await getCertificateThumbprintHex(params.certPem);
  await prisma.deviceCertificate.create({
    data: {
      workspaceSlug: params.workspaceSlug,
      serialNumber: params.serialNumber,
      serialHex: params.serialHex,
      certPem: params.certPem,
      notBefore: params.notBefore,
      notAfter: params.notAfter,
      thumbprintHex,
    },
  });
}

/** Marks every currently-active (not already superseded/revoked) cert for a device as superseded — called right after a renewal successfully issues its replacement. */
export async function supersedeActiveCertificates(workspaceSlug: string, serialNumber: string): Promise<void> {
  await prisma.deviceCertificate.updateMany({
    where: { workspaceSlug, serialNumber, supersededAt: null, revokedAt: null },
    data: { supersededAt: new Date() },
  });
}

/**
 * The identity lookup verifyMtlsIdentity performs on every mTLS-gated
 * request: is there a currently valid (not revoked, not expired), currently
 * issued (not superseded — a renewed-away cert should stop authenticating
 * even if it technically hasn't expired yet) certificate for this CN?
 */
export async function findActiveCertificate(workspaceSlug: string, serialNumber: string): Promise<{ id: string } | null> {
  const row = await prisma.deviceCertificate.findFirst({
    where: {
      workspaceSlug,
      serialNumber,
      revokedAt: null,
      supersededAt: null,
      notAfter: { gt: new Date() },
    },
  });
  return row ? { id: row.id } : null;
}

/**
 * Fire-and-forget "this cert was just used to authenticate a real request" —
 * called by mtlsIdentity.middleware.ts's assertMtlsIdentity right after
 * findActiveCertificate succeeds. Deliberately not awaited by the caller
 * (assertMtlsIdentity kicks this off and moves on) and never throws: this is
 * a nice-to-have freshness signal for the Devices list's "SOAR Agent"
 * column, not part of the actual auth decision — a slow/failed write here
 * must never turn into a failed or delayed mTLS-gated request. See
 * loadCertificateLastSeenBySerial (devices.service.ts) for the batched read
 * side this feeds.
 */
export function touchCertificateLastSeen(certificateId: string): void {
  prisma.deviceCertificate
    .update({ where: { id: certificateId }, data: { lastSeenAt: new Date() } })
    .catch((e: unknown) => {
      console.warn(`[mTLS] touchCertificateLastSeen failed for certificate '${certificateId}': ${e}`);
    });
}

/**
 * Batched, fleet-wide read side of touchCertificateLastSeen above — one
 * query for the whole workspace (matching this file's "load once per
 * fleet-wide call" philosophy, same as loadDevicePushDataCache), keyed by
 * serialNumber so devices.service.ts's per-device loop can look it up
 * alongside the existing DevicePushData-based soarAgentLastReportedAt
 * signal. Only ever the MOST RECENT active-or-superseded cert per serial
 * matters here — a device's older, superseded cert's stale lastSeenAt
 * should never shadow its current cert's fresher one, so this takes the max
 * per serialNumber rather than an arbitrary row.
 */
export async function loadCertificateLastSeenBySerial(workspaceSlug: string): Promise<Record<string, string>> {
  const rows = await prisma.deviceCertificate.findMany({
    where: { workspaceSlug, lastSeenAt: { not: null } },
    select: { serialNumber: true, lastSeenAt: true },
  });
  const bySerial: Record<string, string> = {};
  for (const row of rows) {
    if (!row.lastSeenAt) continue;
    const iso = row.lastSeenAt.toISOString();
    const existing = bySerial[row.serialNumber];
    if (!existing || iso > existing) bySerial[row.serialNumber] = iso;
  }
  return bySerial;
}

export async function revokeCertificate(workspaceSlug: string, id: string, actor: string, reason: string): Promise<void> {
  const row = await prisma.deviceCertificate.findUnique({ where: { id } });
  if (!row || row.workspaceSlug !== workspaceSlug) {
    throw new HttpError(404, "Certificate not found.");
  }
  if (row.revokedAt) {
    throw new HttpError(400, "This certificate is already revoked.");
  }
  await prisma.deviceCertificate.update({
    where: { id },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_certificate_revoked",
    actor,
    severity: "warning",
    targetType: "device",
    targetId: row.serialNumber,
    message: `mTLS device certificate for '${row.serialNumber}' revoked by ${actor}: ${reason}`,
  });
}

// ── Bulk purge of old revoked certificates ──
//
// Revoking a certificate keeps its row (revokedAt set) for the audit trail —
// it's never deleted by revokeCertificate itself. A fleet with real device
// churn (re-enrollments, replacements, employee offboarding) accumulates
// revoked rows indefinitely otherwise. This is a genuine hard DELETE, unlike
// every other retention knob in this app (which only trims logs/metrics),
// so it's off by default (WorkspaceState.certPurgeEnabled) and always
// records exactly what it did.

const CERT_PURGE_DEFAULT_RETENTION_DAYS = 90;
const CERT_PURGE_MIN_RETENTION_DAYS = 1;

export interface CertPurgeSettings {
  enabled: boolean;
  retentionDays: number;
}

export async function getCertPurgeSettings(workspaceSlug: string): Promise<CertPurgeSettings> {
  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return {
    enabled: state?.certPurgeEnabled ?? false,
    retentionDays: state?.certPurgeRetentionDays ?? CERT_PURGE_DEFAULT_RETENTION_DAYS,
  };
}

export async function setCertPurgeSettings(workspaceSlug: string, actor: string, settings: CertPurgeSettings): Promise<CertPurgeSettings> {
  const retentionDays = Math.max(CERT_PURGE_MIN_RETENTION_DAYS, Math.trunc(settings.retentionDays) || CERT_PURGE_DEFAULT_RETENTION_DAYS);
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, certPurgeEnabled: settings.enabled, certPurgeRetentionDays: retentionDays },
    update: { certPurgeEnabled: settings.enabled, certPurgeRetentionDays: retentionDays },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_cert_purge_settings_updated",
    actor,
    severity: "info",
    message: settings.enabled
      ? `Automatic purge of revoked mTLS certificates enabled by ${actor} — certificates revoked more than ${retentionDays} day(s) ago are deleted daily.`
      : `Automatic purge of revoked mTLS certificates disabled by ${actor}.`,
  });
  return { enabled: settings.enabled, retentionDays };
}

/**
 * Hard-deletes revoked certificates past retention, on-demand (Settings >
 * mTLS's "Purge now" button) or from the daily scheduled job below. Only
 * ever touches rows that are ALREADY revoked — an active/expired/superseded-
 * but-not-revoked certificate is never a purge candidate, regardless of age,
 * since those still matter for fleet-migration history and aren't what the
 * user asked to clean up.
 */
export async function purgeRevokedCertificates(workspaceSlug: string, olderThanDays: number, actor: string): Promise<{ purged: number }> {
  const days = Math.max(CERT_PURGE_MIN_RETENTION_DAYS, Math.trunc(olderThanDays) || CERT_PURGE_DEFAULT_RETENTION_DAYS);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.deviceCertificate.deleteMany({
    where: { workspaceSlug, revokedAt: { not: null, lt: cutoff } },
  });
  if (result.count > 0) {
    await recordAuditEvent(workspaceSlug, {
      category: "settings",
      action: "mtls_certificates_purged",
      actor,
      severity: "warning",
      message: `${result.count} revoked mTLS device certificate(s) older than ${days} day(s) permanently deleted by ${actor}.`,
    });
  }
  return { purged: result.count };
}

/**
 * Daily background job (jobs/backgroundJobs.ts's "mtls_cert_purge") —
 * iterates every workspace that has opted in (certPurgeEnabled) and purges
 * using that workspace's own retentionDays. A workspace with no
 * WorkspaceState row yet, or with certPurgeEnabled left at its false
 * default, is never touched — this is deliberately opt-in per workspace,
 * not a global default.
 */
export async function purgeRevokedCertificatesForAllWorkspaces(): Promise<number> {
  const enabledWorkspaces = await prisma.workspaceState.findMany({
    where: { certPurgeEnabled: true },
    select: { workspaceSlug: true, certPurgeRetentionDays: true },
  });
  let totalPurged = 0;
  for (const ws of enabledWorkspaces) {
    const { purged } = await purgeRevokedCertificates(ws.workspaceSlug, ws.certPurgeRetentionDays, "system");
    totalPurged += purged;
  }
  return totalPurged;
}
