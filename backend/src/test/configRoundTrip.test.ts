import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Verifies the Phase 9 sign-off checklist's "a full config export from the
 * old app imports cleanly into the new one" claim — adapted for this
 * migration's per-table (not per-JSON-blob) storage: export workspace A,
 * import that exact bundle into empty workspace B, re-export B, and assert
 * the round-tripped data matches — including that original row IDs survive
 * the trip (config.service.ts's whole reason for delete-then-recreate
 * instead of a naive replace, so cross-references like a Trigger's
 * workflowId aren't silently renumbered).
 *
 * Uses a small in-memory fake Prisma scoped to just this file (via
 * vi.doMock + a fresh module registry, same pattern as
 * rateLimiter.test.ts/triggerSecret.test.ts) rather than setup.ts's
 * always-empty generic mock — a round trip against permanently-empty
 * stores would prove nothing. Only two of the 14 exportable stores get real
 * backing here (compliancePolicy for the "list" handler shape,
 * caseSlaSettings for the "singleton" handler shape) since those are the
 * two distinct STORE_HANDLERS shapes in config.service.ts; the other 12
 * stay on a generic empty-but-non-throwing fallback identical in spirit to
 * setup.ts's, so exportWorkspaceConfig/importWorkspaceConfig's own loop
 * over all CONFIG_STORE_KEYS doesn't blow up on the ones this test isn't
 * exercising directly.
 */

function makeFakePrisma() {
  const compliancePolicyRows: any[] = [
    { id: "policy-1", workspaceSlug: "source-ws", name: "Encrypt disks", enabled: true, conditions: [], mitreTechniques: [] },
  ];
  const caseSlaSettingsRows = new Map<string, any>([
    ["source-ws", { workspaceSlug: "source-ws", enabled: true, notifyOnBreach: true, thresholds: { high: { acknowledgeMinutes: 30, resolveMinutes: 240 } } }],
  ]);

  function generic() {
    return new Proxy(
      {},
      {
        get: (_t, method: string) => {
          if (method === "then") return undefined;
          if (method === "findMany") return async () => [];
          if (method === "count") return async () => 0;
          if (["findUnique", "findFirst"].includes(method)) return async () => null;
          return async () => ({});
        },
      },
    );
  }

  const models: Record<string, unknown> = {
    compliancePolicy: {
      findMany: async ({ where }: any) => compliancePolicyRows.filter((r) => r.workspaceSlug === where.workspaceSlug),
      count: async ({ where }: any) => compliancePolicyRows.filter((r) => r.workspaceSlug === where.workspaceSlug).length,
      deleteMany: async ({ where }: any) => {
        for (let i = compliancePolicyRows.length - 1; i >= 0; i--) {
          if (compliancePolicyRows[i].workspaceSlug === where.workspaceSlug) compliancePolicyRows.splice(i, 1);
        }
      },
      createMany: async ({ data }: any) => {
        compliancePolicyRows.push(...data);
      },
    },
    caseSlaSettings: {
      findUnique: async ({ where }: any) => caseSlaSettingsRows.get(where.workspaceSlug) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = caseSlaSettingsRows.get(where.workspaceSlug);
        const row = existing ? { ...existing, ...update } : create;
        caseSlaSettingsRows.set(where.workspaceSlug, row);
        return row;
      },
    },
  };

  return new Proxy(models, {
    get: (target, prop: string) => {
      if (prop in target) return (target as any)[prop];
      if (prop === "then") return undefined;
      return generic();
    },
  });
}

describe("config export/import round trip", () => {
  let exportWorkspaceConfig: typeof import("../modules/config/config.service").exportWorkspaceConfig;
  let importWorkspaceConfig: typeof import("../modules/config/config.service").importWorkspaceConfig;
  let CONFIG_STORE_KEYS: typeof import("../modules/config/config.schemas").CONFIG_STORE_KEYS;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("../services/prisma", () => ({ prisma: makeFakePrisma() }));
    ({ exportWorkspaceConfig, importWorkspaceConfig } = await import("../modules/config/config.service"));
    ({ CONFIG_STORE_KEYS } = await import("../modules/config/config.schemas"));
  });

  it("exports all 14 documented store keys (settings.md's Backup & Restore list)", async () => {
    expect(CONFIG_STORE_KEYS.length).toBe(14);
    const exported = await exportWorkspaceConfig("source-ws", "tester@example.com");
    expect(exported.schemaVersion).toBe(1);
    for (const key of CONFIG_STORE_KEYS) {
      expect(exported.data).toHaveProperty(key);
    }
  });

  it("a bundle exported from one workspace imports cleanly into an empty one, preserving row IDs", async () => {
    const exported = await exportWorkspaceConfig("source-ws", "tester@example.com");

    const result = await importWorkspaceConfig("target-ws", exported.data, [...CONFIG_STORE_KEYS], "tester@example.com");
    expect(result.status).toBe("ok");
    expect(result.failed).toEqual([]);
    expect(result.imported).toEqual(expect.arrayContaining(["compliancePolicies", "caseSlaSettings"]));

    const reExported = await exportWorkspaceConfig("target-ws", "tester@example.com");
    const targetPolicies = reExported.data.compliancePolicies as any[];
    expect(targetPolicies).toHaveLength(1);
    expect(targetPolicies[0].id).toBe("policy-1"); // original ID preserved, not regenerated
    expect(targetPolicies[0].name).toBe("Encrypt disks");
    expect(targetPolicies[0].workspaceSlug).toBe("target-ws"); // re-scoped to the new tenant

    const targetSla = reExported.data.caseSlaSettings as any;
    expect(targetSla.thresholds.high.resolveMinutes).toBe(240);

    // The source workspace's own data is untouched by importing into a
    // different target — proves this is scoped per-workspace, not global.
    const sourceStillIntact = await exportWorkspaceConfig("source-ws", "tester@example.com");
    expect((sourceStillIntact.data.compliancePolicies as any[])).toHaveLength(1);
  });
});
