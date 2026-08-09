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
 * Distribution as a real deployable "asset" application, so it can be added
 * to Policies exactly like any other managed app. Reuses this app's
 * existing appliveryClient/resolveOrgBase (services/appliveryClient.ts,
 * auth/rbac.service.ts) and the same upload.applivery.io multipart-asset
 * pattern already proven by scriptAssetUpload.ts's createScriptAsset() —
 * generalized here for arbitrary binary content instead of script text.
 *
 * Windows and macOS deliberately don't share one code path for the
 * create/update step: per Applivery's own OpenAPI schema, the Windows
 * enterprise-application endpoint accepts a settable `info: {name,
 * version}`, but the Apple one (used for macOS, `os: "macos"`) does not —
 * its app's display name/version come from the asset itself. That also
 * means Windows apps can be found-and-updated by matching on `info.name`,
 * but macOS apps can't be reliably matched by name at all — which is why
 * WorkspaceState.windowsAgentApplicationId/macosAgentApplicationId exist:
 * remembering the id we created is the only way to update in place on a
 * later republish instead of accumulating duplicate Apps every time.
 */

export type AgentPlatform = "windows" | "macos";

const APPLIVERY_APP_NAME: Record<AgentPlatform, string> = {
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

async function upsertWindowsApp(headers: Record<string, string>, orgBase: string, assetId: string, version: string | null, existingAppId: string | null): Promise<{ id: string; created: boolean }> {
  const baseUrl = `${orgBase}/mdm/windows/enterprise/applications`;
  const payload = { type: "asset", config: { mdmAssetId: assetId }, info: { name: APPLIVERY_APP_NAME.windows, version: version || "1.0.0.0" } };

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
  created: boolean;
  assetId: string;
}

/**
 * POST /api/settings/agent-downloads/publish/:platform — the whole
 * upload-asset-then-create/update-app flow, run with the requesting admin's
 * own live Applivery session (forwarded `Authorization` header + workspace),
 * exactly like every other Applivery-side write this app already makes.
 */
export async function publishAgentBuildToApplivery(authorization: string, workspaceSlug: string, platform: string, actorEmail: string): Promise<PublishResult> {
  assertPlatform(platform);
  const build = await prisma.agentBuild.findUnique({ where: { platform } });
  if (!build) throw new HttpError(404, `No ${platform} agent build has been published yet — the agent repo's CI publishes one automatically on every push to main.`);

  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");

  const assetId = await uploadBinaryAsset(
    authorization,
    uploadBase,
    APPLIVERY_APP_NAME[platform],
    `Applivery SOAR Agent (${platform}) — auto-published from Settings > Device Data Webhook.`,
    build.filename,
    build.contentType,
    build.data as unknown as Buffer,
  );

  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  const existingAppId = platform === "windows" ? state?.windowsAgentApplicationId ?? null : state?.macosAgentApplicationId ?? null;

  const { id: applicationId, created } =
    platform === "windows"
      ? await upsertWindowsApp(headers, orgBase, assetId, build.version, existingAppId)
      : await upsertMacosApp(headers, orgBase, assetId, existingAppId);

  const updateData = platform === "windows" ? { windowsAgentApplicationId: applicationId, windowsAgentPublishedAt: new Date() } : { macosAgentApplicationId: applicationId, macosAgentPublishedAt: new Date() };
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, ...updateData },
    update: updateData,
  });

  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "agent_published_to_applivery", actor: actorEmail,
    targetType: "agent_build", targetId: applicationId, targetName: APPLIVERY_APP_NAME[platform],
    message: `${created ? "Created" : "Updated"} "${APPLIVERY_APP_NAME[platform]}" in Applivery App Distribution from build ${build.filename}`,
  });

  return { applicationId, created, assetId };
}

/** Status shown in Settings — whether this workspace has ever published each platform, and to which Applivery application id. */
export async function getPublishStatus(workspaceSlug: string): Promise<Record<AgentPlatform, { applicationId: string | null; publishedAt: string | null }>> {
  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return {
    windows: { applicationId: state?.windowsAgentApplicationId ?? null, publishedAt: state?.windowsAgentPublishedAt?.toISOString() ?? null },
    macos: { applicationId: state?.macosAgentApplicationId ?? null, publishedAt: state?.macosAgentPublishedAt?.toISOString() ?? null },
  };
}
