import { createApp } from "./app";
import { env } from "./config/env";
import { startBackgroundJobs } from "./jobs/backgroundJobs";

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`SOAR backend listening on :${env.port} (${env.nodeEnv})`);
});

// Global intelligence catalog refreshers (OS Update, Vuln/EUVD, OS
// Lifecycle, GDMF, MITRE) — see jobs/backgroundJobs.ts for what's
// deliberately NOT started yet (per-workspace loops pending Phase 6
// Automation Credentials).
startBackgroundJobs();
