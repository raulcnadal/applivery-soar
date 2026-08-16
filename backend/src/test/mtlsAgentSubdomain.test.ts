import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * agentSubdomain.service.ts — the single, workspace-wide source of truth for
 * the dedicated reverse-proxy vhost that carries the mTLS client-cert
 * directives (see the module's own doc comment and
 * backend/docs/mtls-agent-auth-roadmap.md §5.5 for why this can't live on
 * the dashboard's own domain). Same vi.doMock("../services/prisma", ...)
 * pattern as mtlsGlobalBootstrapToken.test.ts.
 */

const AUDIT_MOCK = { create: vi.fn(async () => ({ id: "log-1" })) };

describe("agentSubdomain.service — single source of truth for the mTLS agent vhost", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getAgentSubdomain returns null when no row exists", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { findUnique: vi.fn(async () => null) } } }));
    const { getAgentSubdomain } = await import("../modules/mtls/agentSubdomain.service");
    await expect(getAgentSubdomain("acme")).resolves.toEqual({ agentSubdomain: null });
  });

  it("getAgentSubdomain returns the stored value when configured", async () => {
    const findUnique = vi.fn(async () => ({ workspaceSlug: "acme", agentSubdomain: "agents.acme.example.com" }));
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { findUnique } } }));
    const { getAgentSubdomain } = await import("../modules/mtls/agentSubdomain.service");
    await expect(getAgentSubdomain("acme")).resolves.toEqual({ agentSubdomain: "agents.acme.example.com" });
  });

  it("setAgentSubdomain upserts and normalizes the value (lowercased, trimmed)", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    const { setAgentSubdomain } = await import("../modules/mtls/agentSubdomain.service");
    const result = await setAgentSubdomain("acme", "tester", "  Agents.Acme.Example.com  ");
    expect(result).toEqual({ agentSubdomain: "agents.acme.example.com" });
    expect(upsert).toHaveBeenCalledWith({
      where: { workspaceSlug: "acme" },
      create: { workspaceSlug: "acme", agentSubdomain: "agents.acme.example.com" },
      update: { agentSubdomain: "agents.acme.example.com" },
    });
  });

  it("setAgentSubdomain strips a stray scheme/path if pasted out of habit", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    const { setAgentSubdomain } = await import("../modules/mtls/agentSubdomain.service");
    const result = await setAgentSubdomain("acme", "tester", "https://agents.acme.example.com/some/path");
    expect(result).toEqual({ agentSubdomain: "agents.acme.example.com" });
  });

  it("setAgentSubdomain(null) clears the value", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    const { setAgentSubdomain } = await import("../modules/mtls/agentSubdomain.service");
    const result = await setAgentSubdomain("acme", "tester", null);
    expect(result).toEqual({ agentSubdomain: null });
    expect(upsert).toHaveBeenCalledWith({
      where: { workspaceSlug: "acme" },
      create: { workspaceSlug: "acme", agentSubdomain: null },
      update: { agentSubdomain: null },
    });
  });
});
