import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Match the original app's behavior: refuse to start without the
    // dashboard secret (ARCHITECTURE.md §2.3) rather than booting insecurely.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8000),

  // Dashboard JWT signing secret — process refuses to start without it,
  // same as DASHBOARD_SECRET in the original FastAPI app.
  dashboardSecret: required("DASHBOARD_SECRET"),

  // Postgres connection string, consumed directly by Prisma too.
  databaseUrl: required("DATABASE_URL"),

  // Applivery outbound API — confirmed base from main.py's APPLIVERY_API_BASE
  // ("https://api.applivery.io/v1"), not the guessed .com host from Phase 0.
  appliveryApiUrl: process.env.APPLIVERY_API_URL ?? "https://api.applivery.io/v1",

  // Applivery's own documented ceiling (docs.applivery.com's platform
  // overview: "10,000 requests per hour with burst capability") — drives
  // the shared outbound TokenBucket in services/appliveryClient.ts.
  // Configurable per deployment in case a given org's actual plan/contract
  // grants a different ceiling than the publicly documented default.
  appliveryRateLimitPerHour: Number(process.env.APPLIVERY_RATE_LIMIT_PER_HOUR ?? 10_000),
  appliveryRateLimitBurst: Number(process.env.APPLIVERY_RATE_LIMIT_BURST ?? 100),

  // Secret used by the two external, secret-in-URL-path receivers
  // (/api/applivery-webhook/receive/:secret is per-workspace and DB-stored;
  // /api/compliance/evaluate-due uses this separate trigger secret, matching
  // the original TRIGGER_SECRET env var).
  triggerSecret: process.env.TRIGGER_SECRET ?? "",

  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),

  // Report generation's Puppeteer PDF pipeline (Phase 7) needs a real
  // Chromium binary — puppeteer-core ships no bundled browser (deliberately,
  // to avoid an unreliable/large download at npm-install time, especially
  // under Alpine's musl libc, which the bundled Chromium doesn't support
  // anyway). The Docker image installs the `chromium` apk package and sets
  // this to its path; local dev can point it at any installed Chrome/Chromium.
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? "",

  // Optional — when set, background jobs (jobs/backgroundJobs.ts) run as
  // BullMQ repeatable jobs backed by this Redis instance instead of
  // in-process setInterval loops, so exactly one instance of each job runs
  // cluster-wide even with multiple backend replicas (needed once the app
  // is scaled horizontally for a large device fleet — see
  // queue/backgroundQueue.ts). Left unset, the app falls back to the
  // original single-process setInterval behavior, which is fine for a
  // single-replica deployment and needs no extra infrastructure.
  redisUrl: process.env.REDIS_URL ?? "",

  // Shared secret the two native agent repos' own GitHub Actions CI POSTs a
  // freshly-built binary to (POST /api/internal/agent-builds/:platform) —
  // a single operator-held secret, not a per-workspace/per-customer one
  // (agentBuilds.service.ts's module doc has the full design: this is what
  // lets Settings > Device Data Webhook offer a zero-configuration agent
  // download to every workspace, no GitHub PAT required). Same
  // optional/fail-closed-if-unset shape as TRIGGER_SECRET above.
  agentBuildIngestSecret: process.env.AGENT_BUILD_INGEST_SECRET ?? "",
};
