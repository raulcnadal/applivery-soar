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
};
