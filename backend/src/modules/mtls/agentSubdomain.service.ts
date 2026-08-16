import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";

/**
 * The single, workspace-wide source of truth for the dedicated reverse-proxy
 * vhost that carries the mTLS client-cert directives (see
 * backend/docs/mtls-agent-auth-roadmap.md §5.5). TLS client-certificate
 * verification can't be scoped below server/vhost level in nginx (or most
 * reverse proxies) — a real deployment attempt confirmed this breaks
 * dashboard access when the directives are added to the same domain — so
 * agent traffic MUST be routed through a separate hostname, and every agent's
 * Managed Configuration BaseURL must point there instead of the dashboard's
 * own origin.
 *
 * Stored on WorkspaceState (schema.prisma), same shape as
 * mtlsEnforcement.service.ts's enforcement flag, since this is genuinely a
 * per-workspace singleton too. Settings > mTLS Agent Authentication's Reverse
 * Proxy Configuration panel is the ONLY place this is set — Settings > Device
 * Data Webhook's Managed Configuration bundle reads it back read-only, so
 * there is exactly one place to change it and every downstream consumer
 * (the generated nginx snippet, every agent's BaseURL) derives from the same
 * value instead of drifting apart.
 */

function normalize(agentSubdomain: string | null): string | null {
  if (agentSubdomain === null) return null;
  // Defensive: strip a stray scheme/path/trailing-slash in case someone
  // pastes a full URL out of habit — the stored value is always a bare host.
  return agentSubdomain
    .trim()
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export async function getAgentSubdomain(workspaceSlug: string): Promise<{ agentSubdomain: string | null }> {
  const row = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return { agentSubdomain: row?.agentSubdomain ?? null };
}

export async function setAgentSubdomain(workspaceSlug: string, actor: string, agentSubdomain: string | null): Promise<{ agentSubdomain: string | null }> {
  const value = normalize(agentSubdomain);

  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, agentSubdomain: value },
    update: { agentSubdomain: value },
  });

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_agent_subdomain_updated",
    actor,
    severity: "info",
    message: value
      ? `Agent subdomain set to "${value}" by ${actor} — every agent's Managed Configuration BaseURL should point here once the dedicated reverse-proxy vhost exists.`
      : `Agent subdomain cleared by ${actor} — agents fall back to this dashboard's own origin (only correct if mTLS isn't in use).`,
  });

  return { agentSubdomain: value };
}
