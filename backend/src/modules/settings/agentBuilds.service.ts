import { createHash } from "crypto";
import { prisma } from "../../services/prisma";
import { appliveryClient } from "../../services/appliveryClient";
import { resolveOrgBase } from "../auth/rbac.service";
import { HttpError } from "../../utils/httpError";
import { recordAuditEvent } from "../../services/auditLog";

/**
 * Applivery SOAR Agent binaries — the zero-configuration replacement for
 * the GitHub-token-based agentDownloads.service.ts (kept, per the decision
 * to leave that as an optional/advanced fallback for whoever already set it
 * up). Both agent repos' own GitHub Actions CI POSTs freshly-built binaries
 * to POST /api/internal/agent-builds/:platform on every push to main,
 * gated by a single operator-held shared secret (env.agentBuildIngestSecret)
 * — NOT a GitHub PAT, and not something any customer/workspace ever needs
 * to configure. Binaries are stored directly in Postgres (AgentBuild, one
 * row per (platform, arch) variant, upserted — a rolling "latest build"
 * store, not a version history) and served publicly with no auth at all
 * from GET /api/agent-downloads/:platform, exactly like pulling a public
 * Docker image: no token, no login, works from a plain curl.
 *
 * Three variants exist today: `windows`/`amd64`, `windows`/`arm64` (the
 * Windows agent repo's CI builds both via WiX — this app originally only
 * mirrored amd64; arm64 is wired up the same way), and `macos`/`universal`
 * (macOS ships one universal binary, so its arch is always "universal").
 * `arch` defaults per-platform (see `normalizeArch`) so callers that only
 * know one variant per platform (the CI ingest step, most download links)
 * don't need to think about it — it only has to be spelled out explicitly
 * for Windows ARM64.
 *
 * "Publish to Applivery" (POST /api/settings/agent-downloads/publish/:platform/:arch)
 * is the other half — an admin, from their own live dashboard session,
 * pushes the SAME stored binary into their own Applivery org as an MDM
 * asset (`mdm/assets`), so it can be added to Policies exactly like any
 * other managed app. Two steps:
 *
 *  1. Asset — `POST {uploadBase}/mdm/assets` (multipart, binary as `file`),
 *     named e.g. `"Applivery SOAR Agent (Windows x64)"` — deliberately
 *     just the human-facing product name, no version or id in it (an
 *     earlier version of this stamped the exact build version into the
 *     name itself, which showed up as a meaningless hash suffix in
 *     Applivery's own Assets list). The version instead goes into the
 *     asset's `description`, tagged with a `[build:<version>]` token
 *     (`<version>` = the AgentBuild row's own `version`, the git commit SHA
 *     the agent repo's CI stamped it with). Before uploading, `GET
 *     {orgBase}/mdm/assets?subType=<platform>&name=<exact name>` plus a
 *     client-side check for that exact description token tells us whether
 *     this exact platform+arch+version was already published — if so,
 *     publish HALTS as a no-op (`alreadyPublished: true`, surfaced to the
 *     admin as an info notice, not silently re-done). Publishing is
 *     entirely under this app's control (the agent repos' CI is the only
 *     writer of AgentBuild.version), so this token match is a reliable
 *     "already uploaded" signal. Without this check, clicking Publish more
 *     than once for the SAME unchanged version created duplicate assets in
 *     Applivery's Assets list; clicking Publish again for the same version
 *     legitimately re-uploads only if an admin manually deleted the asset
 *     from Applivery, in which case the lookup correctly finds nothing.
 *  2. Application — the actual deployable-to-devices object: a Windows
 *     enterprise application (`{orgBase}/mdm/windows/enterprise/applications`)
 *     or an Apple one (`{orgBase}/mdm/apple/enterprise/applications`,
 *     `os: "macos"`), `type: "asset"`, `config: { mdmAssetId }`. Only
 *     reached when step 1 actually uploaded a new asset. Windows x64,
 *     Windows ARM64, and macOS each get their own remembered application id
 *     (WorkspaceState.windows[Amd64|Arm64]AgentApplicationId /
 *     macosAgentApplicationId — three separate deployable applications,
 *     since each references exactly one asset/build), updated in place via
 *     PUT so publishing a newer version never accumulates duplicates; only
 *     created fresh if there's no remembered id (or it's gone stale — PUT
 *     404s). Windows and Apple deliberately don't share one code path:
 *     per Applivery's own OpenAPI schema, the Windows endpoint accepts a
 *     settable `info: {name, version}` but the Apple one doesn't.
 */

export type AgentPlatform = "windows" | "macos";
export type AgentArch = string;

const AGENT_APP_NAME: Record<string, string> = {
  "windows:amd64": "Applivery SOAR Agent (Windows x64)",
  "windows:arm64": "Applivery SOAR Agent (Windows ARM64)",
  "macos:universal": "Applivery SOAR Agent (macOS)",
};

function variantKey(platform: string, arch: string): string {
  return `${platform}:${arch}`;
}

function defaultArch(platform: AgentPlatform): AgentArch {
  return platform === "windows" ? "amd64" : "universal";
}

/** Validates (and defaults) an arch for a given platform — the only two Windows values this app knows how to serve, or "universal" for macOS. */
function normalizeArch(platform: AgentPlatform, arch: string | null | undefined): AgentArch {
  const value = (arch && arch.trim()) || defaultArch(platform);
  if (platform === "windows" && value !== "amd64" && value !== "arm64") {
    throw new HttpError(400, `Windows agent arch must be 'amd64' or 'arm64', got '${value}'.`);
  }
  if (platform === "macos" && value !== "universal") {
    throw new HttpError(400, `macOS agent arch must be 'universal', got '${value}'.`);
  }
  return value;
}

export interface AgentBuildMeta {
  platform: AgentPlatform;
  arch: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  version: string | null;
  publishedAt: string;
}

function toMeta(row: any): AgentBuildMeta {
  return {
    platform: row.platform,
    arch: row.arch,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    version: row.version ?? null,
    publishedAt: row.publishedAt.toISOString(),
  };
}

function assertPlatform(platform: string): asserts platform is AgentPlatform {
  if (platform !== "windows" && platform !== "macos") {
    throw new HttpError(400, "platform must be 'windows' or 'macos'");
  }
}

/** POST /api/internal/agent-builds/:platform — the CI ingest endpoint. `arch` comes from the optional X-Agent-Arch header, defaulting per platform. */
export async function receiveAgentBuild(platform: string, arch: string | null, filename: string, contentType: string, data: Buffer, version: string | null): Promise<AgentBuildMeta> {
  assertPlatform(platform);
  const normalizedArch = normalizeArch(platform, arch);
  if (!data.length) throw new HttpError(400, "Empty request body — no binary data received.");
  const sha256 = createHash("sha256").update(data).digest("hex");
  // Prisma's generated client types the Bytes field as Uint8Array<ArrayBuffer>
  // — Node's own Buffer type (Buffer<ArrayBufferLike>) isn't directly
  // assignable to that under current TS lib settings, even though a Buffer
  // IS a Uint8Array at runtime. Uint8Array.from() produces a fresh,
  // correctly-typed copy.
  const bytes = Uint8Array.from(data);
  const row = await prisma.agentBuild.upsert({
    where: { platform_arch: { platform, arch: normalizedArch } },
    create: { platform, arch: normalizedArch, filename, contentType, sizeBytes: data.length, sha256, data: bytes, version },
    update: { filename, contentType, sizeBytes: data.length, sha256, data: bytes, version, publishedAt: new Date() },
  });
  await recordAuditEvent("global", {
    category: "system", action: "agent_build_received", actor: "ci",
    targetType: "agent_build", targetId: row.id, targetName: filename,
    message: `New ${platform}/${normalizedArch} agent build received (${filename}, ${(data.length / (1024 * 1024)).toFixed(1)} MB)${version ? ` — ${version}` : ""}`,
  });
  return toMeta(row);
}

/** GET /api/agent-downloads/:platform/meta[?arch=] — public, no auth. */
export async function getAgentBuildMeta(platform: string, arch?: string | null): Promise<AgentBuildMeta | null> {
  assertPlatform(platform);
  const normalizedArch = normalizeArch(platform, arch);
  const row = await prisma.agentBuild.findUnique({ where: { platform_arch: { platform, arch: normalizedArch } } });
  return row ? toMeta(row) : null;
}

/** GET /api/agent-downloads — public, no auth; every published variant at once (used by Settings to render one row per variant without N round-trips). */
export async function listAgentBuildMeta(): Promise<AgentBuildMeta[]> {
  const rows = await prisma.agentBuild.findMany({ orderBy: [{ platform: "asc" }, { arch: "asc" }] });
  return rows.map(toMeta);
}

/** GET /api/agent-downloads/:platform[?arch=] — public, no auth, streams the raw binary. */
export async function streamAgentBuild(platform: string, arch?: string | null): Promise<{ filename: string; contentType: string; data: Buffer }> {
  assertPlatform(platform);
  const normalizedArch = normalizeArch(platform, arch);
  const row = await prisma.agentBuild.findUnique({ where: { platform_arch: { platform, arch: normalizedArch } } });
  if (!row) throw new HttpError(404, `No ${platform}/${normalizedArch} agent build has been published yet — the agent repo's CI publishes one automatically on every push to main.`);
  // Prisma's Bytes field comes back as a plain Uint8Array, not a real Node
  // Buffer instance — `row.data as unknown as Buffer` was a type-only
  // assertion, not an actual conversion, so at runtime this was still a
  // Uint8Array wearing a Buffer-shaped TypeScript label. That silently broke
  // every download: the controller's res.send() checks Buffer.isBuffer()
  // before writing raw bytes, that check is false for a plain Uint8Array, so
  // Express fell through to res.json() and JSON-serialized the binary as
  // `{"0":208,"1":207,...}` — a multi-MB text blob wearing an .msi/.pkg
  // filename, which is exactly what "installation package could not be
  // opened" looks like. Buffer.from() here produces a genuine Buffer so
  // Buffer.isBuffer() actually passes downstream.
  return { filename: row.filename, contentType: row.contentType, data: Buffer.from(row.data as unknown as Uint8Array) };
}

// Content-addressed, not version-addressed: two different pushes can land
// on the same git commit/version string (e.g. the Windows agent repo's CI
// publishes amd64 and arm64 from the SAME commit every run), and — the
// scenario that actually bit this exact dedup check in production — a build
// row can get its `data`/`filename` corrected after a transient ingest bug
// without its `version` field changing at all. Keying the dedup token off
// the binary's own sha256 instead means a stale Applivery asset uploaded
// from bad data never blocks (or gets mistaken for) a fresh, corrected
// re-publish: the fingerprint embedded in its description simply won't
// match the current build's fingerprint, so `findExistingAsset` correctly
// reports "no match" and a new upload proceeds — same end result as
// deleting the stale asset by hand, without requiring that manual step.
function buildFingerprint(sha256: string): string {
  return sha256.slice(0, 16);
}

function buildToken(fingerprint: string): string {
  return `[build:${fingerprint}]`;
}

function descriptionFor(fingerprint: string): string {
  return `Auto-published from Settings > Applivery SOAR Agent. ${buildToken(fingerprint)}`;
}

// ── Step 1: the MDM asset — dedup by exact name + description token before uploading ──

/** GET {orgBase}/mdm/assets?subType=&name= — the `name` filter's match semantics aren't documented as exact, so this double-checks client-side for an exact name match with the current build's content-fingerprint token present in the description, rather than trusting the first returned item. */
async function findExistingAsset(headers: Record<string, string>, orgBase: string, platform: AgentPlatform, name: string, fingerprint: string): Promise<string | null> {
  const res = await appliveryClient.get(`${orgBase}/mdm/assets`, { headers, params: { subType: platform, name, limit: 25 } });
  if (res.status >= 300) return null;
  const items = ((res.data as any)?.data?.items ?? []) as Array<{ id: string; name: string; description?: string }>;
  const token = buildToken(fingerprint);
  const match = items.find((it) => it.name === name && typeof it.description === "string" && it.description.includes(token));
  return match?.id ?? null;
}

/** Multipart-uploads raw binary content as a new Applivery mdmAsset — the binary-content sibling of scriptAssetUpload.ts's createScriptAsset() (text-only). */
async function uploadBinaryAsset(authorization: string, uploadBase: string, name: string, description: string, filename: string, contentType: string, data: Buffer): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append("description", description);
  form.append("segmentId", "0");
  form.append("file", new Blob([data], { type: contentType || "application/octet-stream" }), filename);

  const res = await appliveryClient.request({
    method: "POST",
    url: `${uploadBase}/mdm/assets`,
    data: form,
    headers: { Authorization: authorization },
    timeout: 60_000,
  });
  if (res.status >= 300) {
    throw new HttpError(502, `Applivery rejected the asset upload (HTTP ${res.status}): ${String(JSON.stringify(res.data ?? "")).slice(0, 300)}`);
  }
  const id = (res.data as any)?.data?.id;
  if (!id) throw new HttpError(502, "Applivery didn't return an asset id for the upload.");
  return id;
}

// ── Step 2: the actual deployable Windows/Apple enterprise application ──

async function upsertWindowsApp(headers: Record<string, string>, orgBase: string, assetId: string, version: string | null, existingAppId: string | null, appName: string): Promise<{ id: string; created: boolean }> {
  const baseUrl = `${orgBase}/mdm/windows/enterprise/applications`;
  const payload = { type: "asset", config: { mdmAssetId: assetId }, info: { name: appName, version: version || "1.0.0.0" } };

  if (existingAppId) {
    const putRes = await appliveryClient.put(baseUrl + `/${existingAppId}`, payload, { headers });
    if (putRes.status < 300) return { id: existingAppId, created: false };
    // Fall through to create-fresh if the remembered app id no longer
    // exists on Applivery's side (e.g. deleted manually by an admin) —
    // a stale local id shouldn't permanently break republishing.
  }

  const postRes = await appliveryClient.post(baseUrl, payload, { headers });
  if (postRes.status >= 300) {
    throw new HttpError(502, `Applivery rejected the Windows application ${existingAppId ? "update" : "creation"} (HTTP ${postRes.status}): ${String(JSON.stringify(postRes.data ?? "")).slice(0, 300)}`);
  }
  const id = (postRes.data as any)?.data?.id;
  if (!id) throw new HttpError(502, "Applivery didn't return an application id.");
  return { id, created: true };
}

async function upsertMacosApp(headers: Record<string, string>, orgBase: string, assetId: string, existingAppId: string | null): Promise<{ id: string; created: boolean }> {
  const baseUrl = `${orgBase}/mdm/apple/enterprise/applications`;
  // No settable info.name/version for Apple apps (see this file's module
  // doc) — the payload is deliberately minimal.
  const payload = { type: "asset", config: { mdmAssetId: assetId }, os: "macos" };

  if (existingAppId) {
    const putRes = await appliveryClient.put(baseUrl + `/${existingAppId}`, payload, { headers });
    if (putRes.status < 300) return { id: existingAppId, created: false };
  }

  const postRes = await appliveryClient.post(baseUrl, payload, { headers });
  if (postRes.status >= 300) {
    throw new HttpError(502, `Applivery rejected the macOS application ${existingAppId ? "update" : "creation"} (HTTP ${postRes.status}): ${String(JSON.stringify(postRes.data ?? "")).slice(0, 300)}`);
  }
  const id = (postRes.data as any)?.data?.id;
  if (!id) throw new HttpError(502, "Applivery didn't return an application id.");
  return { id, created: true };
}

// ── Per-(platform, arch) WorkspaceState bookkeeping ──

function existingApplicationIdFor(state: { windowsAmd64AgentApplicationId?: string | null; windowsArm64AgentApplicationId?: string | null; macosAgentApplicationId?: string | null } | null, platform: AgentPlatform, arch: AgentArch): string | null {
  if (platform === "windows" && arch === "arm64") return state?.windowsArm64AgentApplicationId ?? null;
  if (platform === "windows") return state?.windowsAmd64AgentApplicationId ?? null;
  return state?.macosAgentApplicationId ?? null;
}

async function persistApplicationId(workspaceSlug: string, platform: AgentPlatform, arch: AgentArch, applicationId: string): Promise<void> {
  const now = new Date();
  const updateData =
    platform === "windows" && arch === "arm64"
      ? { windowsArm64AgentApplicationId: applicationId, windowsArm64AgentPublishedAt: now }
      : platform === "windows"
        ? { windowsAmd64AgentApplicationId: applicationId, windowsAmd64AgentPublishedAt: now }
        : { macosAgentApplicationId: applicationId, macosAgentPublishedAt: now };
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, ...updateData },
    update: updateData,
  });
}

export interface PublishResult {
  applicationId: string;
  assetId: string;
  /** True only when a brand-new application was created (vs. an existing one updated in place). */
  created: boolean;
  /** True when an asset for this exact platform+arch+version already existed on Applivery — publish halted, nothing changed. */
  alreadyPublished: boolean;
  message: string;
}

/**
 * POST /api/settings/agent-downloads/publish/:platform/:arch — asset
 * upload, then create/update the deployable application, run with the
 * requesting admin's own live Applivery session (forwarded `Authorization`
 * header + workspace), exactly like every other Applivery-side write this
 * app already makes. See this file's module doc for the full two-step
 * design and why the description-token dedup check exists.
 */
export async function publishAgentBuildToApplivery(authorization: string, workspaceSlug: string, platform: string, archInput: string, actorEmail: string): Promise<PublishResult> {
  assertPlatform(platform);
  const arch = normalizeArch(platform, archInput);
  const build = await prisma.agentBuild.findUnique({ where: { platform_arch: { platform, arch } } });
  if (!build) throw new HttpError(404, `No ${platform}/${arch} agent build has been published yet — the agent repo's CI publishes one automatically on every push to main.`);
  const version = build.version || build.sha256.slice(0, 12);
  const fingerprint = buildFingerprint(build.sha256);
  const appName = AGENT_APP_NAME[variantKey(platform, arch)];

  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");

  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  const existingAppId = existingApplicationIdFor(state, platform, arch);

  // Step 1: has this exact platform+arch+binary (by content fingerprint,
  // not just version — see buildFingerprint's doc comment) already been
  // uploaded as an asset? If so, halt — no re-upload, no re-touching the
  // application.
  const existingAssetId = await findExistingAsset(headers, orgBase, platform, appName, fingerprint);
  if (existingAssetId) {
    const message = `${appName} build ${version} is already published to Applivery — an asset named "${appName}" for this exact build already exists. Remove it from Applivery's Assets list first if you need to force a re-upload.`;
    return { applicationId: existingAppId ?? "", assetId: existingAssetId, created: false, alreadyPublished: true, message };
  }

  const assetId = await uploadBinaryAsset(authorization, uploadBase, appName, descriptionFor(fingerprint), build.filename, build.contentType, build.data as unknown as Buffer);

  const { id: applicationId, created } =
    platform === "windows" ? await upsertWindowsApp(headers, orgBase, assetId, version, existingAppId, appName) : await upsertMacosApp(headers, orgBase, assetId, existingAppId);

  await persistApplicationId(workspaceSlug, platform, arch, applicationId);

  const message = `${created ? "Created" : "Updated"} "${appName}" in Applivery from build ${build.filename} (${version}).`;

  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "agent_published_to_applivery", actor: actorEmail,
    targetType: "agent_build", targetId: applicationId, targetName: appName,
    message,
  });

  return { applicationId, assetId, created, alreadyPublished: false, message };
}

/** Status shown in Settings — whether this workspace has ever published each variant, and to which Applivery application id. Keyed "platform:arch" (see variantKey). */
export async function getPublishStatus(workspaceSlug: string): Promise<Record<string, { applicationId: string | null; publishedAt: string | null }>> {
  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return {
    [variantKey("windows", "amd64")]: { applicationId: state?.windowsAmd64AgentApplicationId ?? null, publishedAt: state?.windowsAmd64AgentPublishedAt?.toISOString() ?? null },
    [variantKey("windows", "arm64")]: { applicationId: state?.windowsArm64AgentApplicationId ?? null, publishedAt: state?.windowsArm64AgentPublishedAt?.toISOString() ?? null },
    [variantKey("macos", "universal")]: { applicationId: state?.macosAgentApplicationId ?? null, publishedAt: state?.macosAgentPublishedAt?.toISOString() ?? null },
  };
}
