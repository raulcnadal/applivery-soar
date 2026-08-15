import { createHash, randomBytes } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";

/**
 * One-time bootstrap tokens — the "one-time password" a device uses exactly
 * once, to prove to SOAR it's allowed to enroll, before it has a client
 * certificate of its own. See
 * backend/docs/mtls-agent-auth-roadmap.md §2/§4.1.
 *
 * The plaintext token is shown to the admin exactly once, at mint time, and
 * is NEVER stored — only its SHA-256 hash is. This mirrors how e.g. API keys
 * are typically surfaced elsewhere, and means even a full database dump
 * can't be used to mint device certificates on its own.
 */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generatePlaintextToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface MintedBootstrapToken {
  id: string;
  serialNumber: string;
  token: string; // plaintext — only ever returned here, at mint time
  expiresAt: string;
}

export async function mintBootstrapToken(workspaceSlug: string, actor: string, serialNumber: string, expiresInDays: number): Promise<MintedBootstrapToken> {
  const token = generatePlaintextToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const row = await prisma.deviceBootstrapToken.create({
    data: {
      workspaceSlug,
      serialNumber,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy: actor,
    },
  });

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_bootstrap_token_minted",
    actor,
    targetType: "device",
    targetId: serialNumber,
    message: `mTLS bootstrap token minted for device '${serialNumber}' by ${actor}, expires ${expiresAt.toISOString()}.`,
  });

  return { id: row.id, serialNumber, token, expiresAt: expiresAt.toISOString() };
}

export async function mintBootstrapTokensBulk(workspaceSlug: string, actor: string, serialNumbers: string[], expiresInDays: number): Promise<MintedBootstrapToken[]> {
  const results: MintedBootstrapToken[] = [];
  for (const serialNumber of serialNumbers) {
    results.push(await mintBootstrapToken(workspaceSlug, actor, serialNumber, expiresInDays));
  }
  return results;
}

export interface BootstrapTokenStatus {
  id: string;
  serialNumber: string;
  status: "pending" | "used" | "expired";
  expiresAt: string;
  usedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export async function listBootstrapTokens(workspaceSlug: string): Promise<BootstrapTokenStatus[]> {
  const rows = await prisma.deviceBootstrapToken.findMany({
    where: { workspaceSlug },
    orderBy: { createdAt: "desc" },
  });
  const now = Date.now();
  return rows.map((row: (typeof rows)[number]) => ({
    id: row.id,
    serialNumber: row.serialNumber,
    status: row.usedAt ? "used" : row.expiresAt.getTime() < now ? "expired" : "pending",
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function revokeBootstrapToken(workspaceSlug: string, id: string, actor: string): Promise<void> {
  const row = await prisma.deviceBootstrapToken.findUnique({ where: { id } });
  if (!row || row.workspaceSlug !== workspaceSlug) {
    throw new HttpError(404, "Bootstrap token not found.");
  }
  if (row.usedAt) {
    throw new HttpError(400, "This token has already been consumed and can't be revoked (it's already single-use-spent).");
  }
  await prisma.deviceBootstrapToken.delete({ where: { id } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_bootstrap_token_revoked",
    actor,
    targetType: "device",
    targetId: row.serialNumber,
    message: `mTLS bootstrap token for device '${row.serialNumber}' revoked by ${actor} before use.`,
  });
}

/**
 * Validates + atomically consumes a bootstrap token in one statement — an
 * UPDATE ... WHERE usedAt IS NULL that only ever affects 0 or 1 rows under
 * Postgres's normal read-committed isolation, so two concurrent register
 * calls racing on the same token can never both succeed (whichever loses
 * gets count=0 back and is rejected). Deliberately checks `serialNumber`
 * as part of the WHERE clause too: a token minted for device A can never be
 * consumed by a request claiming to be device B, even before we get to the
 * CSR/CN-forcing check in mtlsPki.signDeviceCsr.
 */
export async function consumeBootstrapToken(workspaceSlug: string, serialNumber: string, providedToken: string | undefined): Promise<void> {
  if (!providedToken) {
    throw new HttpError(401, "Missing bootstrap token.");
  }
  const result = await prisma.deviceBootstrapToken.updateMany({
    where: {
      workspaceSlug,
      serialNumber,
      tokenHash: hashToken(providedToken),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (result.count !== 1) {
    throw new HttpError(401, "Invalid, expired, already-used, or mismatched-device bootstrap token.");
  }
}
