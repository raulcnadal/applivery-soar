import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { refreshAppliveryTokens } from "../auth/auth.service";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";

/**
 * Per-workspace "Automation Credential" — a long-lived Applivery
 * access/refresh token pair an admin configures once from Settings, used by
 * every unattended/background code path that has to act without a live
 * human session: the compliance auto-fire engine, Triggers' inbound fire
 * endpoint, and the durable workflow engine's resumer/reconciler loops. Port
 * of main.py:1490-1594 (`_get_automation_bearer` et al). Unlike the
 * original, there's no legacy env-var fallback pair here — this Node app
 * never introduced one, so a workspace either has a stored credential or it
 * doesn't.
 */

export interface AutomationCredentialStatus {
  configured: boolean;
  source: "stored" | null;
  configuredBy?: string | null;
  configuredAt?: string | null;
  lastRefreshedAt?: string | null;
}

export async function getAutomationCredentialStatus(workspaceSlug: string): Promise<AutomationCredentialStatus> {
  const entry = await prisma.automationCredential.findUnique({ where: { workspaceSlug } });
  if (!entry) return { configured: false, source: null };
  return {
    configured: true,
    source: "stored",
    configuredBy: entry.configuredBy,
    configuredAt: entry.configuredAt?.toISOString() ?? null,
    lastRefreshedAt: entry.lastRefreshedAt?.toISOString() ?? null,
  };
}

export interface SetAutomationCredentialPayload {
  apiToken: string;
  refreshToken: string;
  apiTokenExpireAt?: string | null;
  refreshTokenExpireAt?: string | null;
}

export async function setAutomationCredential(workspaceSlug: string, payload: SetAutomationCredentialPayload, actorEmail: string): Promise<void> {
  await prisma.automationCredential.upsert({
    where: { workspaceSlug },
    create: {
      workspaceSlug,
      apiToken: encryptSecret(payload.apiToken),
      refreshToken: encryptSecret(payload.refreshToken),
      apiTokenExpireAt: payload.apiTokenExpireAt ? new Date(payload.apiTokenExpireAt) : null,
      refreshTokenExpireAt: payload.refreshTokenExpireAt ? new Date(payload.refreshTokenExpireAt) : null,
      configuredBy: actorEmail,
      configuredAt: new Date(),
    },
    update: {
      apiToken: encryptSecret(payload.apiToken),
      refreshToken: encryptSecret(payload.refreshToken),
      apiTokenExpireAt: payload.apiTokenExpireAt ? new Date(payload.apiTokenExpireAt) : null,
      refreshTokenExpireAt: payload.refreshTokenExpireAt ? new Date(payload.refreshTokenExpireAt) : null,
      configuredBy: actorEmail,
      configuredAt: new Date(),
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "automation_credential_set", actor: actorEmail,
    message: `Automation credential configured for this workspace by ${actorEmail}`,
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
 * this workspace, refreshing the stored credential first if it's within 2
 * minutes of expiring. Returns null if nothing usable is configured —
 * callers should skip their run for this workspace rather than fail loudly.
 * Port of `_get_automation_bearer` (main.py:1507).
 */
export async function getAutomationBearer(workspaceSlug: string): Promise<string | null> {
  const entry = await prisma.automationCredential.findUnique({ where: { workspaceSlug } });
  if (!entry) return null;

  let needsRefresh = true;
  if (entry.apiTokenExpireAt) {
    needsRefresh = entry.apiTokenExpireAt.getTime() - Date.now() < 120_000;
  }

  if (needsRefresh) {
    const refreshed = await refreshAppliveryTokens(decryptSecret(entry.apiToken), decryptSecret(entry.refreshToken));
    if (refreshed === null) {
      console.warn(`[Automation] Could not refresh the stored credential for workspace '${workspaceSlug}' — it may need to be re-configured from Settings.`);
      return null;
    }
    await prisma.automationCredential.update({
      where: { workspaceSlug },
      data: {
        apiToken: encryptSecret(refreshed.appliveryAccessToken),
        apiTokenExpireAt: refreshed.appliveryAccessTokenExpireAt ? new Date(refreshed.appliveryAccessTokenExpireAt) : null,
        refreshToken: encryptSecret(refreshed.appliveryRefreshToken),
        refreshTokenExpireAt: refreshed.appliveryRefreshTokenExpireAt ? new Date(refreshed.appliveryRefreshTokenExpireAt) : null,
        lastRefreshedAt: new Date(),
      },
    });
    return `Bearer ${refreshed.appliveryAccessToken}`;
  }

  return `Bearer ${decryptSecret(entry.apiToken)}`;
}

/** Every workspace slug with a usable automation credential — background loops iterate this instead of assuming a single workspace. Port of `_automation_workspaces` (main.py:1498), minus the legacy env-var pair. */
export async function listAutomationWorkspaces(): Promise<string[]> {
  const rows = await prisma.automationCredential.findMany({ select: { workspaceSlug: true } });
  return rows.map((r) => r.workspaceSlug).sort();
}
