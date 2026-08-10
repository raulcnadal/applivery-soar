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
 * up). Both agent repos' own GitHub Actions CI POSTs the freshly-built
 * MSI/pkg to POST /api/internal/agent-builds/:platform on every push to
 * main, gated by a single operator-held shared secret
 * (env.agentBuildIngestSecret) — NOT a GitHub PAT, and not something any
 * customer/workspace ever needs to configure. The binary is stored directly
 * in Postgres (AgentBuild, one row per platform, upserted — a rolling
 * "latest build" store, not a version history) and served publicly with no
 * auth at all from GET /api/agent-downloads/:platform, exactly like pulling
 * a public Docker image: no token, no login, works from a plain curl.
 *
 * "Publish to Applivery" (POST /api/settings/agent-downloads/publish/:platform)
 * is the other half — an admin, from their own live dashboard session,
 * pushes the SAME stored binary into their own Applivery org's App
 * Distribution as an MDM asset (`mdm/assets`), so it can be added to
 * Policies exactly like any other managed app. Two steps:
 *
 *  1. Asset — `POST {uploadBase}/mdm/assets` (multipart, binary as `file`),
 *     named `"Applivery SOAR Agent (Windows|macOS) — <version>"` where
 *     `<version>` is the AgentBuild row's own `version` (the git commit SHA
 *     the agent repo's CI stamped it with). Before uploading, `GET
 *     {orgBase}/mdm/assets?subType=<platform>&name=<that exact name>` checks
 *     whether this exact platform+version was already published — if so,
 *     publish HALTS as a no-op (`alreadyPublished: true`, surfaced to the
 *     admin as an info notice, not silently re-done). Publishing is
 *     entirely under this app's control (the agent repos' CI is the only
 *     writer of AgentBuild.version), so this name+subType match is a
 *     reliable "already uploaded" signal — no separate content hash needed.
 *     Without this check, clicking Publish more than once for the SAME
 *     unchanged version created duplicate assets in Applivery's Assets
 *     list (the bug this dedup check exists to close); clicking Publish
 *     again for the same version legitimately re-uploads only if an admin
 *     manually deleted the asset from Applivery, in which case the lookup
 *     correctly finds nothing and re-creates it.
 *  2. Application — the actual deployable-to-devices object: a Windows
 *     enterprise application (`{orgBase}/mdm/windows/enterprise/applications`)
 *     or an Apple one (`{orgBase}/mdm/apple/enterprise/applications`,
 *     `os: "macos"`), `type: "asset"`, `config: { mdmAssetId }`. Only
 *     reached when step 1 actually uploaded a new asset. The remembered
 *     application id (WorkspaceState.windows/macosAgentApplicationId) is
 *     updated in place via PUT so publishing a newer version never
 *     accumulates duplicate applications; only created fresh if there's no
 *     remembered id (or it's gone stale — PUT 404s — mirroring the same
 *     stale-id-falls-through-to-create pattern used everywhere else in this
 *     app). Windows and Apple deliberately don't share one code path here:
 *     per Applivery's own OpenAPI schema, the Windows endpoint accepts a
 *     settable `info: {name, version}` but the Apple one doesn't.
 */

export type AgentPlatform = "windows" | "macos";

const AGENT_APP_NAME: Record<AgentPlatform, string> = {
  windows: "Applivery SOAR Agent (Windows)",
  macos: "Applivery SOAR Agent (macOS)",
};

export interface AgentBuildMeta {
  platform: AgentPlatform;
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

/** POST /api/internal/agent-builds/:platform — the CI ingest endpoint. */
export async function receiveAgentBuild(platform: string, filename: string, contentType: string, data: Buffer, version: string | null): Promise<AgentBuildMeta> {
  assertPlatform(platform);
  if (!data.length) throw new HttpError(400, "Empty request body — no binary data received.");
  const sha256 = createHash("sha256").update(data).digest("hex");
  // Prisma's generated client types the Bytes field as Uint8Array<ArrayBuffer>
  // — Node's own Buffer type (Buffer<ArrayBufferLike>) isn't directly
  // assignable to that under current TS lib settings, even though a Buffer
  // IS a Uint8Array at runtime. Uint8Array.from() produces a fresh,
  // correctly-typed copy.
  const bytes = Uint8Array.from(data);
  const row = await prisma.agentBuild.upsert({
    where: { platform },
    create: { platform, filename, contentType, sizeBytes: data.length, sha256, data: bytes, version },
    update: { filename, contentType, sizeBytes: data.length, sha256, data: bytes, version, publishedAt: new Date() },
  });
  await recordAuditEvent("global", {
    category: "system", action: "agent_build_received", actor: "ci",
    targetType: "agent_build", targetId: row.id, targetName: filename,
    message: `New ${platform} agent build received (${filename}, ${(data.length / (1024 * 1024)).toFixed(1)} MB)${version ? ` — ${version}` : ""}`,
  });
  return toMeta(row);
}

/** GET /api/agent-downloads/:platform/meta — public, no auth. */
export async function getAgentBuildMeta(platform: string): Promise<AgentBuildMeta | null> {
  assertPlatform(platform);
  const row = await prisma.agentBuild.findUnique({ where: { platform } });
  return row ? toMeta(row) : null;
}

/** GET /api/agent-downloads/:platform — public, no auth, streams the raw binary. */
export async function streamAgentBuild(platform: string): Promise<{ filename: string; contentType: string; data: Buffer }> {
  assertPlatform(platform);
  const row = await prisma.agentBuild.findUnique({ where: { platform } });
  if (!row) throw new HttpError(404, `No ${platform} agent build has been published yet — the agent repo's CI publishes one automatically on every push to main.`);
  return { filename: row.filename, contentType: row.contentType, data: row.data as unknown as Buffer };
}

function assetNameFor(platform: AgentPlatform, version: string): string {
  return `${AGENT_APP_NAME[platform]} — ${version}`;
}

// ── Step 1: the MDM asset — dedup by exact name+subType before uploading ──

/** GET {orgBase}/mdm/assets?subType=&name= — the `name` filter's match semantics aren't documented as exact, so this double-checks client-side for an exact match rather than trusting the first returned item. */
async function findExistingAsset(headers: Record<string, string>, orgBase: string, platform: AgentPlatform, version: string): Promise<string | null> {
  const name = assetNameFor(platform, version);
  const res = await appliveryClient.get(`${orgBase}/mdm/assets`, { headers, params: { subType: platform, name, limit: 10 } });
  if (res.status >= 300) return null;
  const items = ((res.data as any)?.data?.items ?? []) as Array<{ id: string; name: string }>;
  const exact = items.find((it) => it.name === name);
  return exact?.id ?? null;
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

async function upsertWindowsApp(headers: Record<string, string>, orgBase: string, assetId: string, version: string | null, existingAppId: string | null): Promise<{ id: string; created: boolean }> {
  const baseUrl = `${orgBase}/mdm/windows/enterprise/applications`;
  const payload = { type: "asset", config: { mdmAssetId: assetId }, info: { name: AGENT_APP_NAME.windows, version: version || "1.0.0.0" } };

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

export interface PublishResult {
  applicationId: string;
  assetId: string;
  /** True only when a brand-new application was created (vs. an existing one updated in place). */
  created: boolean;
  /** True when an asset for this exact platform+version already existed on Applivery — publish halted, nothing changed. */
  alreadyPublished: boolean;
  message: string;
}

/**
 * POST /api/settings/agent-downloads/publish/:platform — asset upload, then
 * create/update the deployable application, run with the requesting admin's
 * own live Applivery session (forwarded `Authorization` header + workspace),
 * exactly like every other Applivery-side write this app already makes. See
 * this file's module doc for the full two-step design and why the
 * name-based dedup check exists.
 */
export async function publishAgentBuildToApplivery(authorization: string, workspaceSlug: string, platform: string, actorEmail: string): Promise<PublishResult> {
  assertPlatform(platform);
  const build = await prisma.agentBuild.findUnique({ where: { platform } });
  if (!build) throw new HttpError(404, `No ${platform} agent build has been published yet — the agent repo's CI publishes one automatically on every push to main.`);
  const version = build.version || build.sha256.slice(0, 12);

  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");

  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  const existingAppId = platform === "windows" ? state?.windowsAgentApplicationId ?? null : state?.macosAgentApplicationId ?? null;

  // Step 1: has this exact platform+version already been uploaded as an
  // asset? If so, halt — no re-upload, no re-touching the application.
  const existingAssetId = await findExistingAsset(headers, orgBase, platform, version);
  if (existingAssetId) {
    const message = `This ${platform} agent build (${version}) is already published to Applivery — an asset named "${assetNameFor(platform, version)}" already exists. Remove it from Applivery's Assets list first if you need to force a re-upload.`;
    return { applicationId: existingAppId ?? "", assetId: existingAssetId, created: false, alreadyPublished: true, message };
  }

  const assetId = await uploadBinaryAsset(
    authorization,
    uploadBase,
    assetNameFor(platform, version),
    `Applivery SOAR Agent (${platform}) — auto-published from Settings > Device Data Webhook.`,
    build.filename,
    build.contentType,
    build.data as unknown as Buffer,
  );

  const { id: applicationId, created } =
    platform === "windows"
      ? await upsertWindowsApp(headers, orgBase, assetId, version, existingAppId)
      : await upsertMacosApp(headers, orgBase, assetId, existingAppId);

  const updateData = platform === "windows" ? { windowsAgentApplicationId: applicationId, windowsAgentPublishedAt: new Date() } : { macosAgentApplicationId: applicationId, macosAgentPublishedAt: new Date() };
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, ...updateData },
    update: updateData,
  });

  const message = `${created ? "Created" : "Updated"} "${AGENT_APP_NAME[platform]}" in Applivery App Distribution from build ${build.filename} (${version}).`;

  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "agent_published_to_applivery", actor: actorEmail,
    targetType: "agent_build", targetId: applicationId, targetName: AGENT_APP_NAME[platform],
    message,
  });

  return { applicationId, assetId, created, alreadyPublished: false, message };
}

/** Status shown in Settings — whether this workspace has ever published each platform, and to which Applivery application id. */
export async function getPublishStatus(workspaceSlug: string): Promise<Record<AgentPlatform, { applicationId: string | null; publishedAt: string | null }>> {
  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return {
    windows: { applicationId: state?.windowsAgentApplicationId ?? null, publishedAt: state?.windowsAgentPublishedAt?.toISOString() ?? null },
    macos: { applicationId: state?.macosAgentApplicationId ?? null, publishedAt: state?.macosAgentPublishedAt?.toISOString() ?? null },
  };
}
