import { vi } from "vitest";

// Required env vars (config/env.ts throws at import time without them) —
// tests never touch a real Postgres or sign real JWTs against a real
// deployment, so these are fixed dummy values, not secrets.
process.env.DASHBOARD_SECRET ??= "test-dashboard-secret-not-real";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";

// ── Generic permissive Prisma mock ─────────────────────────────────────
// RBAC-boundary tests care whether a request clears the auth/RBAC gate
// before reaching a handler — not the handler's exact business response.
// Rather than hand-writing a return shape for every one of the ~35 models
// this app persists (see migration-plan.md §3), every model method resolves
// to a sensible generic default (list methods -> [], singular reads ->
// null, writes -> {}) so any handler that reaches Prisma gets *something*
// back instead of throwing on `undefined`. Individual functional tests
// (separate from RBAC-boundary tests) can still `vi.mocked(...)` a specific
// method for a specific assertion if written directly against this mock.
const LIST_METHODS = new Set(["findMany", "groupBy"]);
const NULLABLE_METHODS = new Set(["findUnique", "findFirst", "findUniqueOrThrow", "findFirstOrThrow"]);
const NUMBER_METHODS = new Set(["count"]);

function defaultForMethod(method: string): unknown {
  if (LIST_METHODS.has(method)) return [];
  if (NULLABLE_METHODS.has(method)) return null;
  if (NUMBER_METHODS.has(method)) return 0;
  // create/update/upsert/delete/aggregate/etc. — an empty object is a safe
  // stand-in for "a row", enough for handlers that just res.json(result).
  return {};
}

function makeModelProxy() {
  return new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === "then") return undefined; // don't look thenable to await/Promise machinery
        return vi.fn(async () => defaultForMethod(method));
      },
    },
  );
}

const prismaMock = new Proxy(
  {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(prismaMock);
      return arg;
    }),
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
  },
  {
    get: (target, prop: string) => {
      if (prop in target) return (target as any)[prop];
      if (prop === "then") return undefined;
      return makeModelProxy();
    },
  },
);

vi.mock("../services/prisma", () => ({ prisma: prismaMock }));

// ── Generic permissive Applivery client mock ───────────────────────────
// Every outbound call to api.applivery.io resolves 200/{} by default —
// real per-endpoint response shapes are exercised by each module's own
// functional tests, not by RBAC-boundary tests.
const appliveryClientMock = {
  request: vi.fn(async () => ({ status: 200, data: {} })),
  get: vi.fn(async () => ({ status: 200, data: {} })),
  post: vi.fn(async () => ({ status: 200, data: {} })),
  put: vi.fn(async () => ({ status: 200, data: {} })),
  delete: vi.fn(async () => ({ status: 200, data: {} })),
};

vi.mock("../services/appliveryClient", () => ({ appliveryClient: appliveryClientMock, AppliveryClient: vi.fn() }));

// ── Generic axios mock ──────────────────────────────────────────────────
// A dozen modules (catalog refreshers, log export senders, report
// generation, script repo browsing, app search) call axios directly
// against real third-party hosts (Apple/NVD/MITRE feeds, GitHub, customer
// webhook URLs) rather than through appliveryClient. RBAC-boundary tests
// only care that a request clears the auth gate, so real outbound network
// calls here would just be slow/flaky noise in CI for no test value.
const axiosMockResponse = { status: 200, data: {}, headers: {} };
const axiosMock: any = {
  get: vi.fn(async () => axiosMockResponse),
  post: vi.fn(async () => axiosMockResponse),
  put: vi.fn(async () => axiosMockResponse),
  delete: vi.fn(async () => axiosMockResponse),
  request: vi.fn(async () => axiosMockResponse),
};
axiosMock.create = vi.fn(() => axiosMock);

vi.mock("axios", () => ({ default: axiosMock, ...axiosMock }));

// ── Rate limiter bypass ─────────────────────────────────────────────────
// The real limiter (rateLimiter.test.ts) is tested directly, in isolation,
// against its own exported bucket functions — not through the full app —
// because its buckets are process-lifetime singletons keyed by req.ip, and
// supertest's ephemeral server makes every request look like the same
// client. Boundary/auth tests would otherwise start tripping 429s partway
// through a run for a reason that has nothing to do with what they're
// testing.
vi.mock("../middleware/rateLimiter.middleware", () => ({
  rateLimiterMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
