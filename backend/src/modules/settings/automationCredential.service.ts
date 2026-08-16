import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { appliveryClient } from "../../services/appliveryClient";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";

/**
 * Per-workspace "Automation Credential" — an Applivery Service Account
 * Bearer token an admin configures once from Settings, used by every
 * unattended/background code path that has to act without a live human
 * session: the compliance auto-fire engine, Triggers' inbound fire endpoint,
 * and the durable workflow engine's resumer/reconciler loops.
 *
 * Rewritten from an earlier session-snapshot design (apiToken/refreshToken
 * pair, "Use this session for automation" — see git history and
 * schema.prisma's AutomationCredential doc comment for the full incident).
 * That design self-refreshed against Applivery's POST /auth/refresh, which
 * rotates the refresh token on every call — a live browser session
 * proactively refreshing itself (frontend/src/composables/useSessionGuards.ts,
 * every ~60s while the tab is open) and this backend's own periodic refresh
 * were two independent consumers racing to rotate the same shared token,
 * silently invalidating each other's copy. A Service Account token has no
 * refresh flow at all (see https://docs.applivery.com/en/platform/api/service-accounts/),
 * which removes the race entirely — this module is now a straightforward
 * encrypt-at-rest store, not a token-refresh state machine.
 */

export interface AutomationCredentialStatus {
  configured: boolean;
  source: "stored" | null;
  configuredBy?: string | null;
  configuredAt?: string | null;
  lastVerifiedAt?: string | null;
}

export async function getAutomationCredentialStatus(workspaceSlug: string): Promise<AutomationCredentialStatus> {
  const entry = await prisma.automationCredential.findUnique({ where: { workspaceSlug } });
  if (!entry || !entry.serviceAccountToken) return { configured: false, source: null };
  return {
    configured: true,
    source: "stored",
    configuredBy: entry.configuredBy,
    configuredAt: entry.configuredAt?.toISOString() ?? null,
    lastVerifiedAt: entry.lastVerifiedAt?.toISOString() ?? null,
  };
}

export interface SetAutomationCredentialPayload {
  serviceAccountToken: string;
}

/**
 * Confirms the pasted token actually authenticates before it's persisted —
 * a bad paste (extra whitespace, wrong token type, already-deleted Service
 * Account) should fail loudly right here in Settings, not silently on the
 * next background job run hours later. GET /organizations/{workspaceSlug} is
 * a cheap, read-only call — same one rbac.service.ts's resolveOrgBase uses
 * to resolve a workspace slug to its Applivery org id.
 */
async function assertServiceAccountTokenWorks(workspaceSlug: string, token: string): Promise<void> {
  let res;
  try {
    res = await appliveryClient.get(`/organizations/${workspaceSlug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new HttpError(502, "Could not reach Applivery to verify this Service Account token — try again in a moment.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(400, "Applivery rejected this Service Account token — double-check it was copied in full, and that the Service Account hasn't been deleted.");
  }
  if (res.status !== 200) {
    throw new HttpError(502, `Applivery API returned ${res.status} while verifying this Service Account token.`);
  }
}

export async function setAutomationCredential(workspaceSlug: string, payload: SetAutomationCredentialPayload, actorEmail: string): Promise<void> {
  const token = payload.serviceAccountToken.trim();
  await assertServiceAccountTokenWorks(workspaceSlug, token);

  const now = new Date();
  await prisma.automationCredential.upsert({
    where: { workspaceSlug },
    create: {
      workspaceSlug,
      serviceAccountToken: encryptSecret(token),
      configuredBy: actorEmail,
      configuredAt: now,
      lastVerifiedAt: now,
    },
    update: {
      serviceAccountToken: encryptSecret(token),
      configuredBy: actorEmail,
      configuredAt: now,
      lastVerifiedAt: now,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "automation_credential_set", actor: actorEmail,
    message: `Automation credential (Service Account) configured for this workspace by ${actorEmail}`,
  });
}

export async function clearAutomationCredential(workspaceSlug: string, actorEmail: string): Promise<void> {
  const existing = await prisma.automationCredential.findUnique({ where: { workspaceSlug } });
  if (!existing) return;
  await prisma.automationCredential.delete({ where: { workspaceSlug } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "automation_credential_cleared", actor: actorEmail, severity: "warning",
    message: "Automation credential removed for this workspace",
  });
}

/**
 * A ready-to-use 'Bearer xxx' string for background jobs operating against
 * this workspace. No refresh step — a Service Account token doesn't expire
 * or rotate, so this is just a decrypt. Returns null if nothing usable is
 * configured (never configured, or a pre-migration row with an empty
 * serviceAccountToken — see the migration's doc comment) — callers should
 * skip their run for this workspace rather than fail loudly.
 */
export async function getAutomationBearer(workspaceSlug: string): Promise<string | null> {
  const entry = await prisma.automationCredential.findUnique({ where: { workspaceSlug } });
  if (!entry || !entry.serviceAccountToken) return null;
  return `Bearer ${decryptSecret(entry.serviceAccountToken)}`;
}

/** Every workspace slug with a usable automation credential — background loops iterate this instead of assuming a single workspace. */
export async function listAutomationWorkspaces(): Promise<string[]> {
  const rows = await prisma.automationCredential.findMany({ where: { serviceAccountToken: { not: "" } }, select: { workspaceSlug: true } });
  return rows.map((r) => r.workspaceSlug).sort();
}
