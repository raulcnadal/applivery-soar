# Applivery SOAR → BlueSky Stack Migration Plan

Status: **Planning output — no application code has been changed yet.** This document is the deliverable for "write the full migration plan before touching anything," per your decisions:

- Full plan first, then execution.
- Incremental delivery by module, each checkpoint runnable, converging on 100% feature parity at the end.
- Target database: **PostgreSQL**.

It supersedes/expands the "BlueSky Migration Guidelines" doc you provided — that doc's Phase 1–4 playbook and its 4-model Prisma schema were a correct skeleton but not sized to this app. This plan is sized to the actual codebase: **183 backend routes, 59 request-payload models, 39 persisted data stores, 17 background jobs, 8 integration types, ~40 MDM device actions, one 17,900-line `main.py` and one 6,400-line `App.jsx`.**

---

## 1. Source-of-truth inventory

Everything below was extracted directly from `big-picture-api/main.py`, `ARCHITECTURE.md`, and `docs/*.md` in your project folder — not assumed.

| Dimension | Count / fact |
|---|---|
| Backend routes (`@app.get/post/put/delete/patch`) | 183, across 44 route-prefix groups (full list: §7) |
| Pydantic request models | 59 (full list: §7) |
| Persisted store "kinds" (generic KV store) | 39 (full list: §7) |
| Background async loops | 17, each heartbeating into System Health |
| Integration types | 8: slack, teams, discord, jira, servicenow, generic_webhook, pagerduty, opsgenie |
| Threat intel provider types | 4: virustotal, abuseipdb, hibp, generic_rest |
| MDM actions registry (`MDM_ACTIONS`) | ~40 entries, the single source of truth for device actions/platforms |
| Compliance condition fields (`COMPLIANCE_FIELDS`) | registry-driven, same "dict is the source of truth" pattern |
| RBAC feature areas | devices, compliance, workflows, cases, integrations, settings (+ reporting, auditLog declared but not gated) |
| RBAC risky actions | canDeletePolicyOrWorkflow, canRunDestructiveWorkflow, canEditIntegrationSecrets, canExportOrImportConfig, canBulkTriage |
| Frontend views (top-level) | Overview (inline in App.jsx), Playground/Globe (inline), Reporting (inline), Devices, Compliance (+App Lists), Cases, Workflows (+Action/Firewall Library), Audit Logs, Settings (13 tabs), Onboarding |
| Frontend non-inline components | 30 files under `src/components/**` |
| PDF report stack | Jinja2 + WeasyPrint (HTML→PDF) + matplotlib (chart images), lazy-imported |
| Storage today | One SQLite file per workspace slug, generic `store(kind, key, value)` table; optional Postgres for durable workflow `wait` steps only |
| Auth model | Two independent tokens: this app's own 30-day dashboard JWT, and the user's real Applivery access/refresh token pair, both minted by one login proxy call |

---

## 2. Locked-in architecture decisions

These are settled; the rest of this document is built on top of them.

1. **Frontend**: Vue 3 (`<script setup>` + TS), Pinia, Vue Router 4, `@applivery/bluesky-vue` for UI primitives, `globe.gl`, `vue-echarts`/ECharts, `grid-layout-plus`, Leaflet (direct, no React wrapper needed — there's no official `vue-leaflet`-equivalent maintained by the BlueSky team, so we'll wrap Leaflet directly in a thin `LeafletMap.vue`, same pattern as `GlobeWidget.vue` in your guidelines doc).
2. **Backend**: Node 20+ LTS, TypeScript, Express, Zod for validation, Prisma ORM.
3. **Database**: PostgreSQL, single instance, single schema. Multi-tenancy is a `workspaceSlug` column on every tenant-scoped table (replacing "one SQLite file per slug") — this is the one deliberate architectural upgrade over the current design, and it's required to use Prisma sanely; everything else in this plan preserves current behavior 1:1.
4. **Deployment topology**: kept identical to today by default — one Node process serves the built Vue `dist/` as static files (same catch-all-to-`index.html` pattern `main.py` uses today) *and* the API, in one container. This isn't a hard requirement of your guidelines doc (which draws them as separate boxes), just the lowest-risk default matching your current `docker-compose.yml`. Flag if you'd rather split them into two services/containers — trivial to change later, not worth deciding now.
5. **Background jobs**: ported as in-process async interval loops (Node `setInterval`/recurring `async` functions), **not** a new queue system (BullMQ/Agenda). The original design is deliberately "single-instance, no Redis" (see `ARCHITECTURE.md` §2.2, §2.5) — introducing a job queue would be a bigger infrastructure change than the migration asked for and isn't needed unless you plan to run multiple backend replicas. Each loop still writes a heartbeat into a `SystemHealthJob` table so Settings → System Health works identically.
6. **Secrets at rest**: currently Fernet (symmetric AES-based), keyed off `DASHBOARD_SECRET`, used for the Vulnerability Service token and integration secrets. Node equivalent: AES-256-GCM via the built-in `crypto` module, key derived from `DASHBOARD_SECRET` with HKDF/scrypt — same security property, no new dependency.
7. **PDF reporting**: Jinja2 + WeasyPrint + matplotlib → **Puppeteer** (headless Chromium renders an HTML template, prints to PDF) + a Node templating engine (Handlebars or the Vue component itself server-rendered) for the HTML, with charts rendered as actual ECharts SVG/canvas output (server-side ECharts rendering, `echarts` supports a Node canvas renderer) instead of matplotlib images. This is a like-for-like capability swap, not a feature reduction.
8. **Rate limiting**: preserved exactly — an Express middleware fixed-window counter keyed by `(path-prefix, client IP)` for inbound (mirroring today's tiers: 10 req/60s on login, 120 req/60s on the two secret-in-path receivers, 300 req/60s catch-all), plus the token-bucket `AppliveryClient` for outbound calls to `api.applivery.com` (your guidelines doc's `TokenBucket`/`AppliveryClient` code is correct as-is and will be used essentially unchanged).
9. **RBAC access cache**: stays in-process, in-memory, keyed `(workspaceSlug, lowercasedEmail)`, 12-hour TTL, fail-closed if absent — this is a deliberate current design choice (`ARCHITECTURE.md` §2.4), not persisted to Postgres, so a login/workspace-switch still needs to call resolve-access first. Not "porting to a DB" for the sake of it.
10. **Testing**: Vitest for pure-function/unit tests (mirrors today's dominant "call the function directly" convention), Supertest against the real Express app for RBAC-boundary tests (mirrors today's `TestClient` convention) — every new gated route gets at least one boundary test, same rule as today.

---

## 3. Complete Prisma schema (draft)

This is the authoritative data model for the whole migration — every one of the 39 current store "kinds" and every Pydantic payload model in §7 maps onto one of these. `workspaceSlug` (renamed from the original `slug`) is the tenancy key everywhere it's needed; global/non-tenant stores (system health, catalogs refreshed once for everyone) omit it, matching today's `_global` pseudo-slug pattern.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ────────────────────────────────────────────────────────────────
// Auth / RBAC — no local user table (every "user" is an Applivery
// Collaborator); Role is the only thing we persist ourselves.
// ────────────────────────────────────────────────────────────────

model Role {
  id                String   @id @default(uuid())
  workspaceSlug     String
  name              String
  description       String?
  featureAccess     Json     // { devices: "none"|"read"|"manage", ... }
  riskyActions      Json     // { canDeletePolicyOrWorkflow: bool, ... }
  appliveryTagValues String[]
  segmentIds        String[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([workspaceSlug])
}

model AutomationCredential {
  workspaceSlug          String   @id
  apiToken               String   // encrypted at rest
  refreshToken           String   // encrypted at rest
  apiTokenExpireAt        DateTime?
  refreshTokenExpireAt    DateTime?
  updatedAt               DateTime @updatedAt
}

// ────────────────────────────────────────────────────────────────
// Workspace-level settings/state (today's single "state" JSON blob)
// ────────────────────────────────────────────────────────────────

model WorkspaceState {
  workspaceSlug                       String   @id
  themeMode                           String?
  webhookUrl                          String?
  smtpConfig                          Json?
  scheduledReports                    Json?    // array
  timezone                            String?
  customReportTemplate                String?  @db.Text
  auditLogRetentionDays               Int?
  sessionTimeoutMinutes                Int?
  installedAppsRefreshBudgetPerHour   Int?
  updatedAt                            DateTime @updatedAt
}

model WidgetLayout {
  id            String   @id @default(uuid())
  workspaceSlug String
  userEmail     String
  layout        Json     // grid-layout-plus positional array
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([workspaceSlug, userEmail])
}

// ────────────────────────────────────────────────────────────────
// Compliance engine
// ────────────────────────────────────────────────────────────────

model CompliancePolicy {
  id                    String   @id @default(uuid())
  workspaceSlug         String
  name                  String
  description           String?
  enabled               Boolean  @default(true)
  autoRun               Boolean  @default(false)
  severity              String   @default("medium")
  conditionLogic        String   @default("any") // 'any' | 'all'
  conditions            Json     // ConditionRule[] {field, operator, value}
  workflowId            String?
  nonComplianceTag      String?
  smartAttributeId      String?
  segmentId             String?
  evaluationIntervalMinutes Int  @default(60)
  autoRunBatchCap       Int      @default(15)
  autoRunDestructiveAck Boolean  @default(false)
  circuitBreakerTripped Boolean  @default(false)
  mitreTechniques       String[]
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  violations ComplianceViolation[]
  @@index([workspaceSlug])
}

model ComplianceViolation {
  id             String   @id @default(uuid())
  workspaceSlug  String
  policyId       String
  policy         CompliancePolicy @relation(fields: [policyId], references: [id])
  deviceId       String
  deviceName     String?
  status         String   // open | approved | dismissed | resolved
  detail         Json?
  detectedAt     DateTime @default(now())
  resolvedAt     DateTime?

  @@index([workspaceSlug, policyId])
  @@index([workspaceSlug, status])
}

model PolicyQuarantineEntry {
  id             String   @id @default(uuid())
  workspaceSlug  String
  policyId       String
  deviceId       String
  reason         String
  createdAt      DateTime @default(now())

  @@index([workspaceSlug, policyId])
}

model ComplianceEvaluationState {
  workspaceSlug   String   @id
  lastEvaluatedAt Json     // { [policyId]: isoTimestamp }
  circuitBreakers  Json     // { [policyId]: { trippedAt, consecutiveFailures } }
}

// ────────────────────────────────────────────────────────────────
// Workflows — two execution engines, same schema
// ────────────────────────────────────────────────────────────────

model Workflow {
  id                       String   @id @default(uuid())
  workspaceSlug            String
  name                     String
  description              String?
  steps                    Json     // WorkflowStep[]
  targetPlatform           String?
  targetDeploymentModel    String?
  recovery                 Json     // WorkflowRecoveryConfig
  allowUnattendedDestructive Boolean @default(false)
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  versions WorkflowVersion[]
  @@index([workspaceSlug])
}

model WorkflowVersion {
  id          String   @id @default(uuid())
  workflowId  String
  workflow    Workflow @relation(fields: [workflowId], references: [id])
  snapshot    Json     // full Workflow payload at save time
  createdAt   DateTime @default(now())

  @@index([workflowId])
}

model WorkflowRun {
  id                String   @id @default(uuid())
  workspaceSlug     String
  workflowId        String
  targetDescription String?
  status            String   // running | waiting | completed | failed
  log               Json     // per-device, per-step execution log
  startedAt         DateTime @default(now())
  completedAt       DateTime?

  pendingSteps WorkflowPendingStep[]
  results      WorkflowRunResult[]
  @@index([workspaceSlug, workflowId])
}

// Durable "wait"/"run_script_wait" step state — the Postgres-only
// part of the current design, ported directly.
model WorkflowPendingStep {
  id           String   @id @default(uuid())
  runId        String
  run          WorkflowRun @relation(fields: [runId], references: [id])
  deviceId     String
  stepId       String
  resumeAt     DateTime // indexed "what's due right now" query
  context      Json
  createdAt    DateTime @default(now())

  @@index([resumeAt])
  @@index([runId])
}

model WorkflowRunResult {
  id         String   @id @default(uuid())
  runId      String
  run        WorkflowRun @relation(fields: [runId], references: [id])
  deviceId   String
  stepId     String
  status     String   // success | failure | waiting
  detail     Json?
  recordedAt DateTime @default(now())

  @@index([runId])
}

// ────────────────────────────────────────────────────────────────
// Triggers, Cases, Case automation
// ────────────────────────────────────────────────────────────────

model Trigger {
  id                String   @id @default(uuid())
  workspaceSlug     String
  name              String
  description       String?
  workflowId        String
  enabled           Boolean  @default(true)
  openCase          Boolean  @default(false)
  caseSeverity      String   @default("medium")
  deviceLookupField String?
  secret            String   // path secret, rotatable
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([workspaceSlug])
}

model Case {
  id              String   @id @default(uuid())
  workspaceSlug   String
  title           String
  status          String   @default("open")
  severity        String   @default("medium")
  deviceId        String?
  deviceName      String?
  assignee        String?
  mitreTechniques String[]
  source          String   // compliance_violation | workflow_trigger | manual | applivery_webhook
  slaAcknowledgedAt DateTime?
  slaResolvedAt     DateTime?
  slaBreached       Boolean @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  notes      CaseNote[]
  activity   CaseActivity[]
  @@index([workspaceSlug, status])
}

model CaseNote {
  id        String   @id @default(uuid())
  caseId    String
  case      Case     @relation(fields: [caseId], references: [id])
  text      String   @db.Text
  author    String
  createdAt DateTime @default(now())

  @@index([caseId])
}

model CaseActivity {
  id        String   @id @default(uuid())
  caseId    String
  case      Case     @relation(fields: [caseId], references: [id])
  type      String   // integration_dispatch | ticket_sync | workflow_run | enrichment | ...
  detail    Json
  createdAt DateTime @default(now())

  @@index([caseId])
}

model CaseAutoRunRule {
  id                    String   @id @default(uuid())
  workspaceSlug         String
  name                  String
  enabled               Boolean  @default(true)
  minSeverity           String   @default("high")
  mitreTechniques       String[]
  workflowId            String
  autoRunDestructiveAck Boolean  @default(false)
  maxFiresPerHour       Int      @default(10)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([workspaceSlug])
}

model CaseSlaSettings {
  workspaceSlug   String  @id
  enabled         Boolean @default(true)
  notifyOnBreach  Boolean @default(true)
  thresholds      Json    // { [severity]: { acknowledgeMinutes, resolveMinutes } }
  updatedAt       DateTime @updatedAt
}

// ────────────────────────────────────────────────────────────────
// Integrations, Threat Intel, Applivery inbound webhook
// ────────────────────────────────────────────────────────────────

model Integration {
  id                          String   @id @default(uuid())
  workspaceSlug               String
  name                        String
  type                        String   // slack|teams|discord|jira|servicenow|generic_webhook|pagerduty|opsgenie
  enabled                     Boolean  @default(true)
  notifyOnOpen                Boolean  @default(true)
  notifyOnClose               Boolean  @default(false)
  minSeverity                 String   @default("low")
  autoCloseCaseOnRemoteResolve Boolean @default(false)
  pageOnSystemHealthAlert     Boolean  @default(false)
  config                      Json     // encrypted secret fields inline (webhook URL, API token, project key, etc.)
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  @@index([workspaceSlug])
}

model ThreatIntelProvider {
  id            String   @id @default(uuid())
  workspaceSlug String
  name          String
  type          String   // virustotal | abuseipdb | hibp | generic_rest
  enabled       Boolean  @default(true)
  config        Json     // encrypted apiKey / urlTemplate+headers
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug])
}

model ThreatIntelCache {
  id         String   @id @default(uuid())
  workspaceSlug String
  ioc        String
  providerType String
  result     Json
  cachedAt   DateTime @default(now())
  expiresAt  DateTime // 6h TTL from cachedAt

  @@unique([workspaceSlug, ioc, providerType])
}

model AppliveryWebhookConfig {
  workspaceSlug String @id
  enabled       Boolean @default(true)
  secret        String
  updatedAt     DateTime @updatedAt

  rules AppliveryWebhookRule[]
}

model AppliveryWebhookRule {
  id                    String  @id @default(uuid())
  workspaceSlug         String
  actionKey             String  // Applivery native event type
  label                 String?
  enabled               Boolean @default(false)
  openCase              Boolean @default(false)
  caseSeverity          String  @default("medium")
  runWorkflow           Boolean @default(false)
  workflowId            String?
  autoRunDestructiveAck Boolean @default(false)

  workspace AppliveryWebhookConfig @relation(fields: [workspaceSlug], references: [workspaceSlug])
  @@unique([workspaceSlug, actionKey])
}

// ────────────────────────────────────────────────────────────────
// Device/MDM operational data
// ────────────────────────────────────────────────────────────────

model DeviceAudience {
  id            String   @id @default(uuid())
  workspaceSlug String
  name          String
  description   String?
  selectors     Json     // DeviceAudienceSelectors
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug])
}

model DevicePushData {
  id            String   @id @default(uuid())
  workspaceSlug String
  deviceId      String
  kind          String   // self-reported attribute set, security-attributes, etc.
  payload       Json
  reportedAt    DateTime
  createdAt     DateTime @default(now())

  @@index([workspaceSlug, deviceId])
}

model InstalledAppInventory {
  id            String   @id @default(uuid())
  workspaceSlug String
  deviceId      String
  apps          Json     // [{identifier, name, version}]
  agentVersion  String?
  reportedAt    DateTime
  updatedAt     DateTime @updatedAt

  @@unique([workspaceSlug, deviceId])
}

model PendingAppReport {
  id            String   @id @default(uuid())
  workspaceSlug String
  deviceId      String
  payload       Json
  createdAt     DateTime @default(now())

  @@index([workspaceSlug])
}

model DeviceReportSecret {
  workspaceSlug String  @id
  secret        String  // encrypted
  updatedAt     DateTime @updatedAt
}

model ScriptRunTracking {
  id            String   @id @default(uuid())
  workspaceSlug String
  deviceId      String
  scriptId      String
  status        String   // pending | success | failed
  requestedAt   DateTime @default(now())
  resolvedAt    DateTime?

  @@index([workspaceSlug, status])
}

model FirewallRuleSet {
  id                     String   @id @default(uuid())
  workspaceSlug          String
  name                   String
  description            String?
  ensureFirewallEnabled  Boolean  @default(true)
  defaultInboundAction   String   @default("notConfigured")
  defaultOutboundAction  String   @default("notConfigured")
  rules                  Json     // FirewallRulePayload[]
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@index([workspaceSlug])
}

model FirewallRemediationState {
  id            String   @id @default(uuid())
  workspaceSlug String
  deviceId      String
  rulesetId     String
  appliedState  Json     // pre-apply snapshot, for restore
  appliedAt     DateTime @default(now())

  @@unique([workspaceSlug, deviceId, rulesetId])
}

// ────────────────────────────────────────────────────────────────
// Action library, script repos, app catalog/lists
// ────────────────────────────────────────────────────────────────

model ActionLibraryEntry {
  id            String   @id @default(uuid())
  workspaceSlug String
  type          String   // script | oma_uri
  name          String
  description   String?
  platform      String
  assetId       String?
  assetName     String?
  arguments     String?
  scope         String?  @default("machine")
  path          String?
  action        String?
  format        String?
  value         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug])
}

model ScriptRepo {
  id            String   @id @default(uuid())
  workspaceSlug String
  name          String
  owner         String
  repo          String
  branch        String   @default("main")
  path          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug])
}

model AppCatalogEntry {
  id            String   @id @default(uuid())
  workspaceSlug String
  platform      String
  identifier    String
  name          String?
  iconUrl       String?
  source        String   @default("manual")
  createdAt     DateTime @default(now())

  @@unique([workspaceSlug, platform, identifier])
}

model AppList {
  id            String   @id @default(uuid())
  workspaceSlug String
  name          String
  description   String?
  platform      String
  appIds        String[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug])
}

// ────────────────────────────────────────────────────────────────
// Vulnerability Service (opt-in) + shared global catalogs
// ────────────────────────────────────────────────────────────────

model VulnServiceConfig {
  workspaceSlug         String  @id
  enabled               Boolean @default(false)
  baseUrl               String  @default("")
  apiToken              String? // encrypted
  refreshIntervalHours  Int     @default(6)
  updatedAt             DateTime @updatedAt
}

model VulnServiceCache {
  id            String   @id @default(uuid())
  workspaceSlug String
  key           String   // product/version lookup key
  result        Json
  cachedAt      DateTime @default(now())

  @@unique([workspaceSlug, key])
}

// Global (non-tenant) catalogs — one row per source, refreshed by a
// background job, read by every workspace. Mirrors today's "_global"
// pseudo-slug SQLite file.
model GlobalCatalog {
  source        String   @id // 'gdmf' | 'os_lifecycle' | 'os_updates' | 'vuln_catalog' | 'mitre'
  payload       Json
  lastRefreshedAt DateTime @default(now())
}

model LocationCache {
  key       String   @id // geo lookup key (IP/city/etc.)
  payload   Json
  cachedAt  DateTime @default(now())
}

model AnalyticsSnapshot {
  id            String   @id @default(uuid())
  workspaceSlug String
  source        String
  date          String   // "YYYY-MM-DD"
  payload       Json
  createdAt     DateTime @default(now())

  @@unique([workspaceSlug, date, source])
}

// ────────────────────────────────────────────────────────────────
// Audit logging, log export, system health, config export
// ────────────────────────────────────────────────────────────────

model AuditLogEntry {
  id          String   @id @default(uuid())
  workspaceSlug String
  category    String
  action      String
  actor       String
  targetType  String?
  targetId    String?
  targetName  String?
  message     String   @db.Text
  severity    String   @default("info")
  createdAt   DateTime @default(now())

  @@index([workspaceSlug, createdAt])
}

model LogExportDestination {
  id            String   @id @default(uuid())
  workspaceSlug String
  type          String   // syslog | webhook | s3 | nfs | sftp
  name          String
  enabled       Boolean  @default(true)
  format        String   @default("json") // json | cef — real-time types only
  config        Json     // encrypted secret fields inline
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug])
}

model SystemHealthJob {
  jobKey        String   @id
  status        String   // ok | error
  detail        String?
  lastHeartbeatAt DateTime @default(now())
  lastAlertSentAt DateTime?
}

// Convenience append-only record of every config export/import/clone
// action — not in the original app as a distinct table (it just reads
// EXPORTABLE_CONFIG_STORES live), kept here only as an audit trail;
// optional to implement in Phase 6.
model ConfigOperationLog {
  id            String   @id @default(uuid())
  workspaceSlug String
  operation     String   // export | import | clone
  stores        String[]
  actor         String
  createdAt     DateTime @default(now())
}
```

Notes on the schema:

- Every `Json` field mirrors a `Dict[str, Any]`/`List[...]` in the original Pydantic models in §7 — deliberately kept as JSON rather than fully normalized, matching the original app's own "flexible payload" philosophy (e.g. `WorkflowStep.config`, `ConditionRule`, integration `config`). Normalizing these further is possible later but isn't required for parity and would slow the migration down for no behavioral benefit.
- Anything holding a secret (`Integration.config`, `ThreatIntelProvider.config`, `LogExportDestination.config`, `AutomationCredential.*Token`, `DeviceReportSecret.secret`, `VulnServiceConfig.apiToken`) is encrypted at the application layer before it hits Prisma — same as today's Fernet fields — not relying on Postgres-level encryption.
- `Role` replaces `soar_roles`; there is intentionally no `User`/`Collaborator` table — RBAC identity still comes live from Applivery, exactly as today.

---

## 4. Backend endpoint migration map

All 183 routes carry over 1:1 in path and method (Express mirrors FastAPI's routing closely enough that no URL contract needs to change for existing frontend-adjacent consumers, though the frontend itself is being rewritten anyway). Grouped by module below with the Prisma models and RBAC area each group touches; the full flat route list is in §7 for traceability.

| Module (route prefix) | Routes | RBAC area | Prisma models | Notes |
|---|---|---|---|---|
| `/api/auth/*` | 3 | none (pre-auth) + `resolve-access` populates cache | — | Login proxy, refresh proxy, resolve-access — thin wrappers over Applivery's API, ported near-verbatim from your guidelines doc's pattern |
| `/api/roles/*` | 7 | settings (manage), super-admin only for role CRUD | `Role` | Includes live Applivery collaborators-directory passthrough, test-access simulator |
| `/api/devices/*`, `/api/device-tags`, `/api/device-audiences/*`, `/api/segments`, `/api/mdm-users*`, `/api/mdm-actions`, `/api/deployment-models`, `/api/smart-attributes`, `/api/policies` | 7+1+3+1+2+1+1+1+1 | devices | `DeviceAudience` (+ live Applivery device data, not persisted) | `MDM_ACTIONS`/`COMPLIANCE_FIELDS`-style registries ported as static TS const objects, single source of truth for frontend pickers |
| `/api/device-data/*` (report, report-apps) | 2 | none — secret-header auth (device agent), not dashboard-token | `DevicePushData`, `InstalledAppInventory`, `PendingAppReport` | Inbound receivers from the self-report agent scripts |
| `/api/compliance/*` | 18 | compliance | `CompliancePolicy`, `ComplianceViolation`, `PolicyQuarantineEntry`, `ComplianceEvaluationState` | Includes MITRE-suggestion endpoint, template gallery, field/attribute-name catalogs |
| `/api/workflows/*`, `/api/action-library/*`, `/api/firewall-rulesets*`, `/api/firewall-ruleset-templates`, `/api/script-repos/*`, `/api/script-assets/*` | 13+5+4+1+5+5 | workflows | `Workflow`, `WorkflowVersion`, `WorkflowRun`, `WorkflowPendingStep`, `WorkflowRunResult`, `ActionLibraryEntry`, `FirewallRuleSet`, `FirewallRemediationState`, `ScriptRepo` | Dual execution engine is the highest-risk single piece — its own dedicated phase (§5 Phase 4) |
| `/api/cases/*`, `/api/case-autorun-rules/*`, `/api/case-sla-settings` | 12+4+2 | cases | `Case`, `CaseNote`, `CaseActivity`, `CaseAutoRunRule`, `CaseSlaSettings` | Enrich = threat intel; retry-integrations, sync-ticket-status tie into Integrations module |
| `/api/integrations/*`, `/api/threat-intel/*` | 5+5 | integrations | `Integration`, `ThreatIntelProvider`, `ThreatIntelCache` | Per-type dispatch (chat/webhook shared sender, Jira/ServiceNow bespoke, PagerDuty/Opsgenie shared pager sender) |
| `/api/triggers/*`, `/api/applivery-webhook/*` | 6+4 | integrations/settings for CRUD; the two `/receive/` and `/fire/` endpoints are secret-in-path, no dashboard token | `Trigger`, `AppliveryWebhookConfig`, `AppliveryWebhookRule` | Preserve secret-in-URL auth model exactly — do not add dashboard-token requirement to these two |
| `/api/audit-logs/*` | 3 | none currently gated (per ARCHITECTURE.md, declared but not enforced — preserve as-is unless you want to tighten it) | `AuditLogEntry` | Export + actor-list + filterable query |
| `/api/settings/*` (automation-credential, device-report-secret/scripts, log-export-destinations, test-smtp) | 14 | settings | `AutomationCredential`, `DeviceReportSecret`, `LogExportDestination` | device-report-scripts endpoints serve the static agent shell/PowerShell scripts from `scripts/` |
| `/api/config/*` | 4 | settings + `canExportOrImportConfig` risky-action gate | reads `EXPORTABLE_CONFIG_STORES`-equivalent table list | Export/import/clone/workspace-status — wholesale overwrite semantics preserved (never merge) |
| `/api/app-catalog*`, `/api/app-lists/*`, `/api/app-search`, `/api/apps` | 3+8+1+1 | compliance (App Lists is a Compliance sub-view) | `AppCatalogEntry`, `AppList`, `InstalledAppInventory` | Installed-apps refresher budget lives here too |
| `/api/vuln-catalog/*`, `/api/vuln-service/*`, `/api/os-updates/*`, `/api/os-lifecycle/*`, `/api/gdmf/*`, `/api/mitre/*`, `/api/apple-app-updates/*` | 2+4+2+2+2+2+2 | compliance (these feed condition fields) | `GlobalCatalog`, `VulnServiceConfig`, `VulnServiceCache` | All read-mostly catalogs refreshed by background jobs (§5) |
| `/api/analytics/*`, `/api/layout`, `/api/state`, `/api/reports/generate`, `/api/help*` | 5+2+2+1+2 | reporting/none | `AnalyticsSnapshot`, `WidgetLayout`, `WorkspaceState`, `LocationCache` | Widget data-source endpoint (`/api/analytics/widget`) is the one the Overview grid polls per-widget every 60s — preserve that per-widget-GET shape, don't "optimize" it into a bulk endpoint, since Reporting's Builder reuses the exact same catalog/shape |
| `/api/system-health` | 1 | settings | `SystemHealthJob` | Aggregates all 17 loops |
| `/{full_path:path}` catch-all | 1 | — | — | Serves Vue's built `index.html` for client-side routing, path-traversal-guarded, same as today |

---

## 5. Background job migration map

All 17 loops, ported as Node async interval functions, each registered in a small in-process scheduler (no external queue, per decision §2.5) and each writing to `SystemHealthJob`.

| Loop | Interval | Target Prisma models |
|---|---|---|
| Compliance scheduler | 60s tick, per-policy interval | `CompliancePolicy`, `ComplianceViolation`, `ComplianceEvaluationState` |
| Report scheduler | 60s | `WorkspaceState.scheduledReports` |
| Snapshot scheduler | daily | `AnalyticsSnapshot` |
| Installed apps refresher | 30s | `InstalledAppInventory` |
| Workflow wait resumer | 30s | `WorkflowPendingStep` (the one loop that requires Postgres — now unconditionally available since Postgres is the only DB) |
| Audit log rotation | daily | `AuditLogEntry` |
| Log export scheduler (batch: S3/NFS/SFTP) | daily | `LogExportDestination` |
| Script log reconciler | 90s | `ScriptRunTracking` |
| Ticket status sync (Jira/ServiceNow) | 15 min | `Case`, `Integration` |
| Case SLA monitor | 5 min | `Case`, `CaseSlaSettings` |
| OS update catalog refresh | daily | `GlobalCatalog` (source=os_updates) |
| Vuln catalog refresh | daily | `GlobalCatalog` (source=vuln_catalog) |
| Vuln Service refresh | hourly check, per-workspace interval | `VulnServiceConfig`, `VulnServiceCache` |
| OS lifecycle refresh | weekly | `GlobalCatalog` (source=os_lifecycle) |
| GDMF refresh | daily | `GlobalCatalog` (source=gdmf) |
| MITRE catalog refresh | daily | `GlobalCatalog` (source=mitre) |
| System health monitor | 5 min | `SystemHealthJob` (scans all others, including itself) |

Note: since Postgres is now the *only* database (not optional), the "workflow containing a wait step is refused at launch if `DATABASE_URL` isn't set" guard from the current app no longer applies — durable workflows just always work. That's a strict improvement, not a behavior change to flag as risky.

---

## 6. Frontend migration map

| Current (React, in `wow-dashboard/src/`) | New (Vue 3, in `frontend/src/`) | Pinia store(s) |
|---|---|---|
| `App.jsx` root state machine + inline Overview/Playground/Reporting | `router/index.ts` (Vue Router) + `views/OverviewView.vue`, `views/PlaygroundView.vue`, `views/ReportingView.vue` | `stores/auth.ts`, `stores/ui.ts` (theme, segment) |
| Auth screens (credentials → mfa → workspace picker), axios interceptors | `views/LoginView.vue` + `stores/auth.ts` (holds both tokens, mirrors §1.3's two-token model) + an axios/fetch wrapper module with the same request/response interceptor logic | `stores/auth.ts` |
| `currentView` state + RBAC-filtered top nav array | `router/index.ts` routes + a navigation guard calling `hasFeatureAccess` equivalent from `stores/auth.ts` | `stores/auth.ts` |
| `THEME.light/dark`, `themeMode`, prop-drilled `theme` | `stores/ui.ts` (`themeMode` ref + computed `activeTheme`), consumed via `useUiStore()` instead of prop-drilling — a real improvement Vue/Pinia gives us for free | `stores/ui.ts` |
| `src/utils/segments.js` (segment tree walking) | `utils/segments.ts`, ported near-verbatim (pure functions, framework-agnostic) | — |
| Overview widget system: `CATALOG`, `WIDGET_DESCRIPTIONS`, `SOURCE_SHAPES`, `ALL_CHART_TYPES`, `SIZES`, `DEFAULT_DASHBOARD`, per-widget `GET /api/analytics/widget` polling, `react-grid-layout` | `constants/widgetCatalog.ts` + `components/dashboard/DashboardGrid.vue` (wraps `grid-layout-plus`) + `components/dashboard/WidgetCard.vue`, same per-widget-GET-in-parallel polling pattern | `stores/dashboard.ts` |
| `react-globe.gl` Playground globe | `components/dashboard/GlobeWidget.vue` (per your guidelines doc's example — verified correct) | `stores/dashboard.ts` |
| `echarts-for-react` charts | `components/dashboard/TelemetryChart.vue` via `vue-echarts` (per your guidelines doc's example — verified correct) | — |
| `react-leaflet` + `react-leaflet-cluster` device map | `components/devices/DeviceMap.vue`, thin wrapper around Leaflet + `leaflet.markercluster`, mounted/unmounted in `onMounted`/`onBeforeUnmount` (no official Vue Leaflet binding is part of the BlueSky package, so this is hand-wrapped, same pattern as `GlobeWidget.vue`) | `stores/devices.ts` |
| `src/components/devices/*.jsx` (4 files) | `components/devices/*.vue` | `stores/devices.ts` |
| `src/components/compliance/*.jsx` (4 files) | `components/compliance/*.vue` | `stores/compliance.ts` |
| `src/components/cases/CasesView.jsx` | `views/CasesView.vue` + `components/cases/*.vue` | `stores/cases.ts` |
| `src/components/workflows/*.jsx` (5 files) | `components/workflows/*.vue` | `stores/workflows.ts` |
| `src/components/audit/AuditLogsView.jsx` | `views/AuditLogsView.vue` | `stores/auditLogs.ts` |
| `src/components/settings/*.jsx` (13 files) + inline settings tabs in `App.jsx` | `components/settings/*.vue`, all 13 tabs converted to real components (no inline tabs left in the new stack — cleaner than today), mounted conditionally exactly like today (`v-if="isSettingsModalOpen"`) so each panel still fetches fresh data every open | `stores/settings.ts` |
| `src/components/onboarding/WorkspaceOnboardingModal.jsx` | `components/onboarding/WorkspaceOnboardingModal.vue` | `stores/onboarding.ts` |
| `src/components/shared/ViewSwitcher.jsx`, `MitreCatalog.jsx` | `components/shared/ViewSwitcher.vue`, `composables/useMitreCatalog.ts` | — |
| Modal shell (`ModalHeader`), `window.confirm(...)` pattern, bare `alert(...)`/inline error banners, no toast system | Use BlueSky's `Modal.vue`/`Drawer.vue` for the shell, but **keep the `window.confirm`/no-toast conventions exactly as-is** — this is a deliberate, documented convention in the current app, not an accident to "fix" during a migration whose goal is zero feature loss | — |
| `@solar-icons/react` aliasing convention | `@solar-icons/vue` (per BlueSky's Vue package peer-dependency), same alias-to-conventional-name pattern | — |

---

## 7. Full traceability appendix

Kept here in full so nothing gets silently dropped during implementation — every persisted store, every request model, and every route above should trace back to one of these three lists.

### 7.1 All 39 persisted store kinds (SQLite `kind` values today → Prisma model above)

`action_library, app_catalog, app_lists, applivery_webhook_config, audit_log, automation_credentials, case_autorun_rules, case_sla_settings, cases, compliance_policies, compliance_state, compliance_violations, dashboard_state, device_pushdata, device_report_secrets, firewall_library, firewall_remediation_state, gdmf_catalog, installed_apps, integrations, layout, locations_cache, log_export_destinations, mitre_catalog, os_lifecycle_catalog, os_update_catalog, pending_app_reports, policy_quarantine, script_repos, script_run_tracking, snapshot, soar_roles, system_health, threat_intel_providers, triggers, vuln_catalog, vuln_service_cache, vuln_service_config, workflow_runs, workflow_versions, workflows`

### 7.2 All 59 Pydantic request models (by name — fields captured during audit, available on request)

`AppliveryLoginPayload, RefreshPayload, LayoutPayload, ReportPayload, RolePayload, CollaboratorTagsPayload, TestAccessPayload, AutomationCredentialPayload, StatePayload, ConfigClonePayload, ConfigImportPayload, SMTPTestPayload, LogExportDestinationPayload, SegmentUpdatePayload, TagsUpdatePayload, PolicyRef, PoliciesUpdatePayload, DeviceAudienceSelectors, DeviceAudienceCreatePayload, ActionLibraryEntryPayload, ActionLibraryImportPayload, FirewallRulePayload, FirewallRuleSetPayload, WorkflowStep, WorkflowRecoveryConfig, WorkflowPayload, WorkflowDeviceRef, WorkflowRunRequest, WorkflowDryRunRequest, DeviceReportPayload, BulkReattestPayload, AppCatalogAddPayload, AppListPayload, ScriptAssetCreatePayload, ScriptAssetEditPayload, ScriptRepoPayload, ScriptRepoImportPayload, InstalledAppsBudgetPayload, DeviceAppReportPayload, SuggestMitreTechniquesPayload, ConditionRule, CompliancePolicyPayload, EvaluateNowPayload, BulkViolationIdsPayload, CaseCreatePayload, CaseUpdatePayload, CaseNotePayload, CaseBulkUpdatePayload, CaseRunWorkflowPayload, CaseSlaThresholdPayload, CaseSlaSettingsPayload, CaseAutoRunRulePayload, TriggerPayload, AppliveryWebhookRulePayload, AppliveryWebhookConfigPayload, IntegrationPayload, ThreatIntelProviderPayload, CaseEnrichPayload, VulnServiceConfig`

### 7.3 All 183 routes, grouped by prefix

```
/{full_path:path}  (1)
  GET    /{full_path:path}

api/action-library  (5)
  GET    /api/action-library
  POST   /api/action-library
  POST   /api/action-library/import
  DELETE /api/action-library/{entry_id}
  PUT    /api/action-library/{entry_id}

api/analytics  (5)
  GET    /api/analytics/device-risk-trend
  POST   /api/analytics/locations/sync
  GET    /api/analytics/snapshots
  POST   /api/analytics/snapshots/capture
  GET    /api/analytics/widget

api/app-catalog  (3)
  GET    /api/app-catalog
  POST   /api/app-catalog
  DELETE /api/app-catalog/{entry_id}

api/app-lists  (8)
  GET    /api/app-lists
  POST   /api/app-lists
  PUT    /api/app-lists/installed-apps-budget
  GET    /api/app-lists/installed-apps-status
  POST   /api/app-lists/refresh-installed-apps
  DELETE /api/app-lists/{list_id}
  PUT    /api/app-lists/{list_id}
  GET    /api/app-lists/{list_id}/usage

api/app-search  (1)
  GET    /api/app-search

api/apple-app-updates  (2)
  POST   /api/apple-app-updates/refresh
  GET    /api/apple-app-updates/status

api/applivery-webhook  (4)
  GET    /api/applivery-webhook
  PUT    /api/applivery-webhook
  POST   /api/applivery-webhook/receive/{secret}
  POST   /api/applivery-webhook/rotate-secret

api/apps  (1)
  GET    /api/apps

api/audit-logs  (3)
  GET    /api/audit-logs
  GET    /api/audit-logs/actors
  GET    /api/audit-logs/export

api/auth  (3)
  POST   /api/auth/login
  POST   /api/auth/refresh
  POST   /api/auth/resolve-access

api/case-autorun-rules  (4)
  GET    /api/case-autorun-rules
  POST   /api/case-autorun-rules
  DELETE /api/case-autorun-rules/{rule_id}
  PUT    /api/case-autorun-rules/{rule_id}

api/case-sla-settings  (2)
  GET    /api/case-sla-settings
  PUT    /api/case-sla-settings

api/cases  (12)
  GET    /api/cases
  POST   /api/cases
  GET    /api/cases/assignee-suggestions
  POST   /api/cases/bulk-update
  GET    /api/cases/export
  GET    /api/cases/{case_id}
  PUT    /api/cases/{case_id}
  POST   /api/cases/{case_id}/enrich
  POST   /api/cases/{case_id}/notes
  POST   /api/cases/{case_id}/retry-integrations
  POST   /api/cases/{case_id}/run-workflow
  POST   /api/cases/{case_id}/sync-ticket-status

api/compliance  (18)
  POST   /api/compliance/evaluate
  POST   /api/compliance/evaluate-due
  GET    /api/compliance/fields
  GET    /api/compliance/policies
  POST   /api/compliance/policies
  DELETE /api/compliance/policies/{policy_id}
  PUT    /api/compliance/policies/{policy_id}
  GET    /api/compliance/policies/{policy_id}/violating-device-ids
  GET    /api/compliance/self-reported-attribute-names
  GET    /api/compliance/smart-attribute-names
  POST   /api/compliance/suggest-mitre-techniques
  GET    /api/compliance/templates
  GET    /api/compliance/violations
  POST   /api/compliance/violations/bulk-approve
  POST   /api/compliance/violations/bulk-dismiss
  GET    /api/compliance/violations/export
  POST   /api/compliance/violations/{violation_id}/approve
  POST   /api/compliance/violations/{violation_id}/dismiss

api/config  (4)
  POST   /api/config/clone-from
  GET    /api/config/export
  POST   /api/config/import
  GET    /api/config/workspace-status

api/deployment-models  (1)
  GET    /api/deployment-models

api/device-audiences  (3)
  GET    /api/device-audiences
  POST   /api/device-audiences
  GET    /api/device-audiences/{audience_id}/matched-devices

api/device-data  (2)
  POST   /api/device-data/report
  POST   /api/device-data/report-apps

api/device-tags  (1)
  GET    /api/device-tags

api/devices  (7)
  GET    /api/devices
  POST   /api/devices/bulk-reattest
  GET    /api/devices/{device_id}/compliance
  GET    /api/devices/{device_id}/firewall-state
  PUT    /api/devices/{device_id}/policies
  PUT    /api/devices/{device_id}/segment
  PUT    /api/devices/{device_id}/tags

api/firewall-ruleset-templates  (1)
  GET    /api/firewall-ruleset-templates

api/firewall-rulesets  (4)
  GET    /api/firewall-rulesets
  POST   /api/firewall-rulesets
  DELETE /api/firewall-rulesets/{ruleset_id}
  PUT    /api/firewall-rulesets/{ruleset_id}

api/gdmf  (2)
  GET    /api/gdmf/catalog
  POST   /api/gdmf/refresh

api/help  (2)
  GET    /api/help
  GET    /api/help/{doc_slug}

api/integrations  (5)
  GET    /api/integrations
  POST   /api/integrations
  DELETE /api/integrations/{integration_id}
  PUT    /api/integrations/{integration_id}
  POST   /api/integrations/{integration_id}/test

api/layout  (2)
  GET    /api/layout
  POST   /api/layout

api/mdm-actions  (1)
  GET    /api/mdm-actions

api/mdm-user-tags  (1)
  GET    /api/mdm-user-tags

api/mdm-users  (1)
  GET    /api/mdm-users

api/mitre  (2)
  POST   /api/mitre/refresh
  GET    /api/mitre/techniques

api/os-lifecycle  (2)
  GET    /api/os-lifecycle/catalog
  POST   /api/os-lifecycle/refresh

api/os-updates  (2)
  GET    /api/os-updates/catalog
  POST   /api/os-updates/refresh

api/policies  (1)
  GET    /api/policies

api/reports  (1)
  POST   /api/reports/generate

api/roles  (7)
  GET    /api/roles
  POST   /api/roles
  GET    /api/roles/collaborators-directory
  PUT    /api/roles/collaborators/{collaborator_id}
  POST   /api/roles/test-access
  DELETE /api/roles/{role_id}
  PUT    /api/roles/{role_id}

api/script-assets  (5)
  GET    /api/script-assets
  POST   /api/script-assets
  GET    /api/script-assets/browse
  PUT    /api/script-assets/{asset_id}
  GET    /api/script-assets/{asset_id}/content

api/script-repos  (5)
  GET    /api/script-repos
  POST   /api/script-repos
  POST   /api/script-repos/import
  DELETE /api/script-repos/{repo_id}
  GET    /api/script-repos/{repo_id}/browse

api/segments  (1)
  GET    /api/segments

api/settings  (14)
  DELETE /api/settings/automation-credential
  GET    /api/settings/automation-credential
  POST   /api/settings/automation-credential
  GET    /api/settings/device-report-scripts-security/{platform}
  GET    /api/settings/device-report-scripts/{platform}
  DELETE /api/settings/device-report-secret
  GET    /api/settings/device-report-secret
  POST   /api/settings/device-report-secret
  GET    /api/settings/log-export-destinations
  POST   /api/settings/log-export-destinations
  DELETE /api/settings/log-export-destinations/{destination_id}
  PUT    /api/settings/log-export-destinations/{destination_id}
  POST   /api/settings/log-export-destinations/{destination_id}/test
  POST   /api/settings/test-smtp

api/smart-attributes  (1)
  GET    /api/smart-attributes

api/state  (2)
  GET    /api/state
  POST   /api/state

api/system-health  (1)
  GET    /api/system-health

api/threat-intel  (5)
  GET    /api/threat-intel/providers
  POST   /api/threat-intel/providers
  DELETE /api/threat-intel/providers/{provider_id}
  PUT    /api/threat-intel/providers/{provider_id}
  POST   /api/threat-intel/providers/{provider_id}/test

api/triggers  (6)
  GET    /api/triggers
  POST   /api/triggers
  POST   /api/triggers/fire/{trigger_id}/{secret}
  DELETE /api/triggers/{trigger_id}
  PUT    /api/triggers/{trigger_id}
  POST   /api/triggers/{trigger_id}/rotate-secret

api/vuln-catalog  (2)
  GET    /api/vuln-catalog/catalog
  POST   /api/vuln-catalog/refresh

api/vuln-service  (4)
  GET    /api/vuln-service/config
  PUT    /api/vuln-service/config
  POST   /api/vuln-service/refresh
  POST   /api/vuln-service/test

api/workflows  (13)
  GET    /api/workflows
  POST   /api/workflows
  POST   /api/workflows/resume-due
  GET    /api/workflows/runs
  GET    /api/workflows/runs/export
  GET    /api/workflows/runs/{run_id}
  DELETE /api/workflows/{workflow_id}
  PUT    /api/workflows/{workflow_id}
  POST   /api/workflows/{workflow_id}/dry-run
  POST   /api/workflows/{workflow_id}/run
  GET    /api/workflows/{workflow_id}/versions
  GET    /api/workflows/{workflow_id}/versions/{version_id}
  POST   /api/workflows/{workflow_id}/versions/{version_id}/restore
```

---

## 8. Phased checkpoint roadmap

Each phase ends with a runnable, demoable increment. Phase 0 sets up both new trees side-by-side with the current app (which keeps running, untouched, until final cutover in Phase 9). Nothing in the old `wow-dashboard`/`big-picture-api` folders is modified during the migration — the new `frontend/`/`backend/` trees are built fresh alongside them, per your "duplicated project folder" setup.

| Phase | Scope | Checkpoint / demo |
|---|---|---|
| **0 — Scaffolding** | Node/TS backend skeleton (Express, Prisma, Zod, `env.ts`, `appliveryClient.ts`, `tokenBucket.ts`); Vue 3 + Vite + TS frontend skeleton (Pinia, Vue Router, `@applivery/bluesky-vue` wired, `bluesky-tokens.css`); full `schema.prisma` from §3 committed and migrated; Docker Compose for Postgres + both services | `docker compose up` boots an empty shell app; Prisma Studio shows all tables |
| **1 — Auth + RBAC** | `/api/auth/*`, `/api/roles/*`, dashboard JWT middleware, RBAC cache + `require_permission`-equivalent middleware, frontend `LoginView.vue` + `stores/auth.ts` + navigation guard | Full login flow (credentials → MFA → workspace picker) works end-to-end against a real Applivery org, top nav renders RBAC-filtered |
| **2 — Devices** | `/api/devices/*`, device-tags/audiences/segments/mdm-actions/policies, `DeviceMap.vue` (Leaflet), `DeviceFleetTable.vue`, `DeviceDetailDrawer.vue` | Devices view fully functional: fleet table, map, segment filter, tag/policy edit, bulk reattest |
| **3 — Compliance + catalogs** | `/api/compliance/*`, App Lists/Catalog, Installed Apps, Vuln Catalog/Service, OS Updates/Lifecycle, GDMF, MITRE; all 6 related background jobs | Policy Builder, violation queue (approve/dismiss/bulk), App Lists, template gallery all functional |
| **4 — Workflows** | `/api/workflows/*` (both engines), Action Library, Firewall Rulesets, Script Repos/Assets, Triggers; workflow wait-resumer job | Workflow Builder, dry-run, live run (incl. a `wait` step pausing and resuming), version history/restore all functional |
| **5 — Cases + Integrations** | `/api/cases/*`, SLA settings, autorun rules, `/api/integrations/*`, `/api/threat-intel/*`; ticket-sync + SLA-monitor jobs | Case lifecycle end-to-end incl. at least one live chat integration firing and one ticketing integration syncing status |
| **6 — Audit, Settings, Config** | `/api/audit-logs/*`, `/api/settings/*` (all sub-pages), `/api/config/*`, System Health; remaining background jobs (audit rotation, log export, system health monitor) | Settings modal fully rebuilt (all 13 tabs), export/import/clone a workspace config, audit log rotation verified |
| **7 — Overview + Reporting** | `/api/analytics/*`, `/api/layout`, `/api/state`, `/api/reports/generate`; `DashboardGrid.vue`, `GlobeWidget.vue`, `TelemetryChart.vue`, Reporting Builder/Schedules/Template, Puppeteer PDF pipeline | Overview dashboard with drag/resize widgets persisting layout, Playground globe, a scheduled report actually emailing a generated PDF |
| **8 — External receivers + Onboarding** | `/api/applivery-webhook/*`, `/api/triggers/fire/*`, `WorkspaceOnboardingModal.vue`, `/api/help/*` | External webhook fires a rule and opens a Case; brand-new empty workspace shows onboarding; docs viewer works |
| **9 — Parity QA + cutover** | Full RBAC-boundary test suite (Supertest), rate-limit verification, all 17 jobs confirmed heartbeating, side-by-side feature diff against the original app's `docs/*.md`, then swap Docker Compose to serve the new stack | Sign-off checklist below cleared; old `wow-dashboard`/`big-picture-api` retired |

**Phase 9 sign-off checklist** (the actual "100% feature parity" verification): every route in §7.3 has a passing test; every one of the 39 stores in §7.1 round-trips through Prisma; all 17 background jobs show `ok` in System Health for 24h continuous; RBAC boundary tests exist for every gated route; the two secret-in-path receivers work with zero dashboard-token involvement; a full config export from the old app imports cleanly into the new one.

---

## 9. Open items for you (non-blocking — defaults assumed, flag if wrong)

- Deployment topology default (§2.4): single container, Node serves Vue's built `dist/`. Say so if you want split frontend/backend services instead.
- Job scheduling default (§2.5): in-process loops, no Redis/queue. Say so if you're planning multiple backend replicas (which would need a real queue instead).
- `reporting` and `auditLog` RBAC areas are declared today but not actually enforced by any endpoint (per `ARCHITECTURE.md` §2.4) — plan preserves that as-is; flag if you want them actually gated this time around.

---

**Next step**: on your go-ahead, Phase 0 (scaffolding) starts — it's pure setup (no feature logic yet) so it's a safe, fast first checkpoint to validate the whole toolchain (Prisma migrate, Vite build, BlueSky components rendering) before Phase 1 touches anything with real behavior.
