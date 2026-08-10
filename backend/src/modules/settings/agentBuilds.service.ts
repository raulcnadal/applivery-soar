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
 * Distribution, so it can be added to Policies exactly like any other
 * managed app. This follows Applivery's REAL three-tier App Distribution
 * model (confirmed against Applivery's own API docs — an earlier version of
 * this file shortcut straight to `mdm/assets` + `mdm/<os>/enterprise/applications`
 * with `type: "asset"`, which Applivery rejected with a 404 "Build ... not
 * found in organization" once an application actually tried to reference
 * it — asset uploads apparently aren't a valid standalone target for an
 * enterprise-application's config):
 *
 *  1. App container — one OS-agnostic App Distribution "Application"
 *     (`GET/POST {orgBase}/apps`), named "Applivery SOAR Agent", SHARED by
 *     both platforms (an App's `oss` can span windows+macos). Looked up by
 *     remembered id first (WorkspaceState.agentDistributionAppId), then by
 *     exact name, created only if neither hit.
 *  2. Build — one per (App, platform, version) under that App
 *     (`GET {orgBase}/apps/:appId/builds`, `POST {uploadBase}/apps/:appId/builds`
 *     multipart with the binary as `file`). Reused if a Build already exists
 *     for this exact platform+versionName (versionName = the AgentBuild row's
 *     `version`, the git commit SHA the agent repo's CI stamped it with) —
 *     re-clicking Publish on the same underlying binary doesn't re-upload.
 *     A freshly-created Build is asynchronously processed by Applivery
 *     (parsing the msi/pkg for productCode/version/etc.) before it's valid
 *     to reference elsewhere — waitForBuildProcessed polls
 *     `GET .../builds/:buildId` until `status: "processed"` (this async gap
 *     is the leading suspect for the old code's 404: referencing an
 *     asset/build immediately after upload, before Applivery finished
 *     processing it).
 *  3. Publication — the actual deployable-to-devices object: a Windows
 *     enterprise application (`{orgBase}/mdm/windows/enterprise/applications`)
 *     or an Apple one (`{orgBase}/mdm/apple/enterprise/applications`,
 *     `os: "macos"`), `type: "build"`, `config: { buildId }`. Checked by
 *     `buildId` first — if a Publication already targets this exact build,
 *     publishing is a no-op (`alreadyPublished: true`, surfaced to the admin
 *     instead of silently re-doing nothing). Otherwise the remembered
 *     Publication id (WorkspaceState.windows/macosAgentApplicationId) is
 *     updated in place via PUT so republishing a newer version never
 *     accumulates duplicate Publications; only created fresh if there's no
 *     remembered id (or it's gone stale — PUT 404s — mirroring the same
 *     stale-id-falls-through-to-create pattern used everywhere else in this
 *     app). Windows and Apple deliberately don't share one code path here:
 *     per Applivery's own OpenAPI schema neither has a settable
 *     name/version worth upserting against anyway — `config.buildId` is
 *     what actually identifies "which version" in both cases.
 */

export type AgentPlatform = "windows" | "macos";

const AGENT_APP_NAME = "Applivery SOAR Agent";

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

// ── Step 1: the shared, OS-agnostic App Distribution "Application" container ──

async function resolveAgentDistributionApp(headers: Record<string, string>, orgBase: string, rememberedAppId: string | null): Promise<string> {
  if (rememberedAppId) {
    const getRes = await appliveryClient.get(`${orgBase}/apps/${rememberedAppId}`, { headers });
    if (getRes.status < 300) return rememberedAppId;
    // Stale remembered id (e.g. deleted manually in the Applivery console) —
    // fall through to search-or-create rather than permanently breaking
    // every future publish.
  }

  const listRes = await appliveryClient.get(`${orgBase}/apps`, { headers, params: { name: AGENT_APP_NAME, limit: 25 } });
  if (listRes.status < 300) {
    const items = ((listRes.data as any)?.data?.items ?? []) as Array<{ id: string; name: string }>;
    const exact = items.find((it) => it.name === AGENT_APP_NAME);
    if (exact?.id) return exact.id;
  }

  const createRes = await appliveryClient.post(`${orgBase}/apps`, { name: AGENT_APP_NAME }, { headers });
  if (createRes.status >= 300) {
    throw new HttpError(502, `Applivery rejected creating the "${AGENT_APP_NAME}" App Distribution app (HTTP ${createRes.status}): ${String(JSON.stringify(createRes.data ?? "")).slice(0, 300)}`);
  }
  const id = (createRes.data as any)?.data?.id;
  if (!id) throw new HttpError(502, "Applivery didn't return an id for the new App Distribution app.");
  return id;
}

// ── Step 2: the per-(app, platform, version) Build ──

async function findExistingBuild(headers: Record<string, string>, orgBase: string, appId: string, platform: AgentPlatform, versionName: string): Promise<{ id: string; status: string } | null> {
  const res = await appliveryClient.get(`${orgBase}/apps/${appId}/builds`, {
    headers,
    params: { os: platform, versionName, limit: 1, sort: "createdAt:desc" },
  });
  if (res.status >= 300) return null;
  const items = ((res.data as any)?.data?.items ?? []) as Array<{ id: string; status: string }>;
  const match = items[0];
  return match?.id ? { id: match.id, status: match.status } : null;
}

async function uploadBuild(authorization: string, uploadBase: string, appId: string, platform: AgentPlatform, filename: string, contentType: string, data: Buffer, versionName: string): Promise<string> {
  const form = new FormData();
  form.append("versionName", versionName);
  form.append("buildPlatform", platform);
  form.append("changelog", "Published from Settings > Device Data Webhook (Applivery SOAR).");
  form.append("file", new Blob([data], { type: contentType || "application/octet-stream" }), filename);

  const res = await appliveryClient.request({
    method: "POST",
    url: `${uploadBase}/apps/${appId}/builds`,
    data: form,
    headers: { Authorization: authorization },
    timeout: 120_000,
  });
  if (res.status >= 300) {
    throw new HttpError(502, `Applivery rejected the ${platform} build upload (HTTP ${res.status}): ${String(JSON.stringify(res.data ?? "")).slice(0, 300)}`);
  }
  const id = (res.data as any)?.data?.id;
  if (!id) throw new HttpError(502, "Applivery didn't return a build id for the upload.");
  return id;
}

/** Applivery processes a freshly-uploaded build asynchronously (parsing the msi/pkg for product metadata) — referencing it from an enterprise application before that finishes is what produced the old code's "Build ... not found" 404. Polls until `processed` (or surfaces `error`). */
async function waitForBuildProcessed(headers: Record<string, string>, orgBase: string, appId: string, buildId: string, platform: AgentPlatform): Promise<void> {
  const deadlineMs = Date.now() + 90_000;
  let lastStatus = "pending";
  while (Date.now() < deadlineMs) {
    const res = await appliveryClient.get(`${orgBase}/apps/${appId}/builds/${buildId}`, { headers });
    if (res.status < 300) {
      const d = (res.data as any)?.data;
      lastStatus = d?.status ?? lastStatus;
      if (lastStatus === "processed") return;
      if (lastStatus === "error") {
        throw new HttpError(502, `Applivery failed to process the ${platform} build: ${d?.error || "unknown error"}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new HttpError(504, `Timed out waiting for Applivery to finish processing the ${platform} build (last status: ${lastStatus}). Try Publish again in a minute — Applivery is still working on it.`);
}

// ── Step 3: the actual deployable Windows/Apple enterprise-application "Publication" ──

async function findWindowsPublicationByBuild(headers: Record<string, string>, orgBase: string, buildId: string): Promise<string | null> {
  const res = await appliveryClient.get(`${orgBase}/mdm/windows/enterprise/applications`, { headers, params: { buildId, limit: 1 } });
  if (res.status >= 300) return null;
  const items = ((res.data as any)?.data?.items ?? []) as Array<{ id: string }>;
  return items[0]?.id ?? null;
}

async function findApplePublicationByBuild(headers: Record<string, string>, orgBase: string, buildId: string): Promise<string | null> {
  const res = await appliveryClient.get(`${orgBase}/mdm/apple/enterprise/applications`, { headers, params: { buildId, os: "macos", limit: 1 } });
  if (res.status >= 300) return null;
  const items = ((res.data as any)?.data?.items ?? []) as Array<{ id: string }>;
  return items[0]?.id ?? null;
}

async function upsertWindowsPublication(headers: Record<string, string>, orgBase: string, buildId: string, existingAppId: string | null): Promise<{ id: string; created: boolean }> {
  const baseUrl = `${orgBase}/mdm/windows/enterprise/applications`;
  const payload = { type: "build", config: { buildId } };

  if (existingAppId) {
    const putRes = await appliveryClient.put(`${baseUrl}/${existingAppId}`, payload, { headers });
    if (putRes.status < 300) return { id: existingAppId, created: false };
    // Stale remembered id — fall through to create-fresh.
  }

  const postRes = await appliveryClient.post(baseUrl, payload, { headers });
  if (postRes.status >= 300) {
    throw new HttpError(502, `Applivery rejected the Windows publication ${existingAppId ? "update" : "creation"} (HTTP ${postRes.status}): ${String(JSON.stringify(postRes.data ?? "")).slice(0, 300)}`);
  }
  const id = (postRes.data as any)?.data?.id;
  if (!id) throw new HttpError(502, "Applivery didn't return a Windows application id.");
  return { id, created: true };
}

async function upsertApplePublication(headers: Record<string, string>, orgBase: string, buildId: string, existingAppId: string | null): Promise<{ id: string; created: boolean }> {
  const baseUrl = `${orgBase}/mdm/apple/enterprise/applications`;
  const payload = { type: "build", config: { buildId }, os: "macos" };

  if (existingAppId) {
    const putRes = await appliveryClient.put(`${baseUrl}/${existingAppId}`, payload, { headers });
    if (putRes.status < 300) return { id: existingAppId, created: false };
  }

  const postRes = await appliveryClient.post(baseUrl, payload, { headers });
  if (postRes.status >= 300) {
    throw new HttpError(502, `Applivery rejected the macOS publication ${existingAppId ? "update" : "creation"} (HTTP ${postRes.status}): ${String(JSON.stringify(postRes.data ?? "")).slice(0, 300)}`);
  }
  const id = (postRes.data as any)?.data?.id;
  if (!id) throw new HttpError(502, "Applivery didn't return a macOS application id.");
  return { id, created: true };
}

export interface PublishResult {
  applicationId: string;
  buildId: string;
  /** True only when a brand-new Publication was created (vs. an existing one updated in place). */
  applicationCreated: boolean;
  /** True only when a brand-new Build was uploaded (vs. an existing processed Build for this exact version reused). */
  buildCreated: boolean;
  /** True when this exact build was already the active Publication on Applivery — nothing changed. */
  alreadyPublished: boolean;
  message: string;
}

/**
 * POST /api/settings/agent-downloads/publish/:platform — App -> Build ->
 * Publication, run with the requesting admin's own live Applivery session
 * (forwarded `Authorization` header + workspace), exactly like every other
 * Applivery-side write this app already makes. See this file's module doc
 * for the full three-step design.
 */
export async function publishAgentBuildToApplivery(authorization: string, workspaceSlug: string, platform: string, actorEmail: string): Promise<PublishResult> {
  assertPlatform(platform);
  const build = await prisma.agentBuild.findUnique({ where: { platform } });
  if (!build) throw new HttpError(404, `No ${platform} agent build has been published yet — the agent repo's CI publishes one automatically on every push to main.`);
  const versionName = build.version || build.sha256.slice(0, 12);

  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");

  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  const appId = await resolveAgentDistributionApp(headers, orgBase, state?.agentDistributionAppId ?? null);

  // Step 2: Build — reuse if this exact platform+version was already uploaded and processed.
  let buildId: string;
  let buildCreated = false;
  const existingBuild = await findExistingBuild(headers, orgBase, appId, platform, versionName);
  if (existingBuild) {
    buildId = existingBuild.id;
    if (existingBuild.status === "error") {
      throw new HttpError(502, `A previous upload of this ${platform} build (${versionName}) failed processing on Applivery's side — click Publish again to re-upload.`);
    }
    if (existingBuild.status !== "processed") {
      await waitForBuildProcessed(headers, orgBase, appId, buildId, platform);
    }
  } else {
    buildId = await uploadBuild(authorization, uploadBase, appId, platform, build.filename, build.contentType, build.data as unknown as Buffer, versionName);
    buildCreated = true;
    await waitForBuildProcessed(headers, orgBase, appId, buildId, platform);
  }

  // Step 3: Publication.
  const existingPublicationId = platform === "windows" ? state?.windowsAgentApplicationId ?? null : state?.macosAgentApplicationId ?? null;
  const alreadyPublishedId = platform === "windows" ? await findWindowsPublicationByBuild(headers, orgBase, buildId) : await findApplePublicationByBuild(headers, orgBase, buildId);

  let applicationId: string;
  let applicationCreated = false;
  const alreadyPublished = Boolean(alreadyPublishedId);

  if (alreadyPublishedId) {
    applicationId = alreadyPublishedId;
  } else {
    const result =
      platform === "windows"
        ? await upsertWindowsPublication(headers, orgBase, buildId, existingPublicationId)
        : await upsertApplePublication(headers, orgBase, buildId, existingPublicationId);
    applicationId = result.id;
    applicationCreated = result.created;
  }

  const updateData =
    platform === "windows"
      ? { agentDistributionAppId: appId, windowsAgentBuildId: buildId, windowsAgentApplicationId: applicationId, windowsAgentPublishedAt: new Date() }
      : { agentDistributionAppId: appId, macosAgentBuildId: buildId, macosAgentApplicationId: applicationId, macosAgentPublishedAt: new Date() };
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, ...updateData },
    update: updateData,
  });

  const message = alreadyPublished
    ? `This ${platform} agent build (${versionName}) is already published to Applivery App Distribution — nothing changed.`
    : `${applicationCreated ? "Created" : "Updated"} the "${AGENT_APP_NAME}" (${platform}) Publication in Applivery App Distribution from build ${build.filename} (${versionName}).`;

  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "agent_published_to_applivery", actor: actorEmail,
    targetType: "agent_build", targetId: applicationId, targetName: `${AGENT_APP_NAME} (${platform})`,
    message,
  });

  return { applicationId, buildId, applicationCreated, buildCreated, alreadyPublished, message };
}

/** Status shown in Settings — whether this workspace has ever published each platform, and to which Applivery application id. */
export async function getPublishStatus(workspaceSlug: string): Promise<Record<AgentPlatform, { applicationId: string | null; publishedAt: string | null }>> {
  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return {
    windows: { applicationId: state?.windowsAgentApplicationId ?? null, publishedAt: state?.windowsAgentPublishedAt?.toISOString() ?? null },
    macos: { applicationId: state?.macosAgentApplicationId ?? null, publishedAt: state?.macosAgentPublishedAt?.toISOString() ?? null },
  };
}
