import { createSocket } from "dgram";
import axios from "axios";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import SftpClient from "ssh2-sftp-client";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { encryptSecret, decryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";
import {
  LOG_EXPORT_BATCH_TYPES, LOG_EXPORT_REALTIME_TYPES, LOG_EXPORT_SECRET_FIELDS,
  type LogExportDestinationPayload,
} from "./logExportDestinations.schemas";

/**
 * Log Export Destinations — port of main.py:2201-2403 (`_export_to_s3` /
 * `_export_to_nfs` / `_export_to_sftp` / CRUD / test-delivery) and
 * main.py:2050-2168 (`_send_syslog` / `_send_webhook` / CEF formatting).
 * Real-time types (syslog/webhook) fire inline from `services/auditLog.ts`
 * on every write; batch types (s3/nfs/sftp) ship once a day via
 * `runLogExportSchedulerTick` (see jobs/backgroundJobs.ts).
 */

export interface AuditEventLike {
  id: string; timestamp: string; category: string; action: string; severity: string;
  actor: string; targetType: string | null; targetId: string | null; targetName: string | null; message: string;
}

function encryptConfig(type: string, config: Record<string, any>): Record<string, any> {
  const out = { ...(config ?? {}) };
  for (const field of LOG_EXPORT_SECRET_FIELDS[type] ?? []) {
    if (out[field]) out[field] = encryptSecret(String(out[field]));
  }
  return out;
}

function decryptConfig(type: string, config: Record<string, any>): Record<string, any> {
  const out = { ...(config ?? {}) };
  for (const field of LOG_EXPORT_SECRET_FIELDS[type] ?? []) {
    if (out[field]) {
      try {
        out[field] = decryptSecret(String(out[field]));
      } catch {
        // malformed/foreign ciphertext — leave as-is rather than throwing
      }
    }
  }
  return out;
}

function toApiShape(row: any) {
  return { ...row, config: decryptConfig(row.type, (row.config as Record<string, any>) ?? {}) };
}

export async function listLogExportDestinations(workspaceSlug: string) {
  const rows = await prisma.logExportDestination.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
  return rows.map(toApiShape);
}

export async function createLogExportDestination(workspaceSlug: string, payload: LogExportDestinationPayload, actor: string) {
  const created = await prisma.logExportDestination.create({
    data: {
      workspaceSlug, type: payload.type, name: payload.name || payload.type.toUpperCase(),
      enabled: payload.enabled, format: payload.format, config: encryptConfig(payload.type, payload.config) as any,
      createdBy: actor,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "log_export_destination_created", actor,
    targetType: "log_export_destination", targetId: created.id, targetName: created.name,
    message: `Log export destination "${created.name}" (${payload.type}) added by ${actor}`,
  });
  return toApiShape(created);
}

export async function updateLogExportDestination(workspaceSlug: string, id: string, payload: LogExportDestinationPayload, actor: string) {
  const existing = await prisma.logExportDestination.findFirst({ where: { id, workspaceSlug } });
  if (!existing) throw new HttpError(404, "Destination not found");
  const updated = await prisma.logExportDestination.update({
    where: { id },
    data: {
      type: payload.type, name: payload.name || payload.type.toUpperCase(),
      enabled: payload.enabled, format: payload.format, config: encryptConfig(payload.type, payload.config) as any,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "log_export_destination_updated", actor,
    targetType: "log_export_destination", targetId: id, targetName: updated.name,
    message: `Log export destination "${updated.name}" updated by ${actor}`,
  });
  return toApiShape(updated);
}

export async function deleteLogExportDestination(workspaceSlug: string, id: string, actor: string) {
  const existing = await prisma.logExportDestination.findFirst({ where: { id, workspaceSlug } });
  if (existing) {
    await prisma.logExportDestination.delete({ where: { id } });
    await recordAuditEvent(workspaceSlug, {
      category: "settings", action: "log_export_destination_deleted", actor, severity: "warning",
      targetType: "log_export_destination", targetId: id, targetName: existing.name,
      message: `Log export destination "${existing.name}" removed by ${actor}`,
    });
  }
  return { status: "ok" };
}

// ── CEF (Common Event Format) ──

const CEF_SEVERITY_MAP: Record<string, number> = { critical: 9, warning: 6, info: 3 };
const SYSLOG_SEVERITY_MAP: Record<string, number> = { critical: 2, warning: 4, info: 6 };

function cefEscapeHeader(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
function cefEscapeExtension(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\n/g, "\\n").replace(/\r/g, "");
}

function formatEventAsCef(event: AuditEventLike): string {
  const name = cefEscapeHeader(event.message || event.action || "event").slice(0, 512);
  const signatureId = cefEscapeHeader(event.action || "unknown");
  const severity = CEF_SEVERITY_MAP[event.severity] ?? 3;
  const parts: string[] = [];
  const add = (key: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== "") parts.push(`${key}=${cefEscapeExtension(value)}`);
  };
  add("cat", event.category);
  add("act", event.action);
  add("suser", event.actor);
  add("msg", event.message);
  add("cs1Label", "TargetType"); add("cs1", event.targetType);
  add("cs2Label", "TargetId"); add("cs2", event.targetId);
  add("cs3Label", "TargetName"); add("cs3", event.targetName);
  if (event.timestamp) {
    const ms = Date.parse(event.timestamp);
    if (!Number.isNaN(ms)) add("rt", String(ms));
  }
  return `CEF:0|Applivery|SOAR|1.0|${signatureId}|${name}|${severity}|${parts.join(" ")}`;
}

// ── Real-time senders ──

/** One UDP datagram per event — port of `_send_syslog` (main.py:2099). */
async function sendSyslog(config: Record<string, any>, events: AuditEventLike[], format: string): Promise<void> {
  const host = config?.host;
  if (!host) throw new Error("Syslog destination has no host configured");
  const port = Number(config?.port) || 514;
  const facility = config?.facility !== undefined && config?.facility !== null ? Number(config.facility) : 16;
  const socket = createSocket("udp4");
  try {
    for (const e of events) {
      const pri = facility * 8 + (SYSLOG_SEVERITY_MAP[e.severity] ?? 6);
      const ts = e.timestamp || new Date().toISOString();
      const msgid = (e.category || "-").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "-";
      const msg = format === "cef" ? formatEventAsCef(e) : `[${e.action}] ${e.message}`;
      const line = `<${pri}>1 ${ts} applivery-soar backend - ${msgid} - ${msg}`;
      await new Promise<void>((resolve, reject) => {
        socket.send(Buffer.from(line, "utf-8").subarray(0, 2048), port, host, (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    socket.close();
  }
}

/** One POST for the whole batch — port of `_send_webhook` (main.py:2125). */
async function sendWebhook(config: Record<string, any>, events: AuditEventLike[], format: string): Promise<void> {
  const url = config?.url;
  if (!url) throw new Error("Webhook destination has no url configured");
  const headers: Record<string, string> = { ...(config?.extraHeaders ?? {}) };
  if (config?.authHeaderValue) headers.Authorization = String(config.authHeaderValue);
  if (format === "cef") {
    const body = events.map(formatEventAsCef).join("\n");
    await axios.post(url, body, { headers: { "Content-Type": "text/plain", ...headers }, timeout: 3000 });
  } else {
    await axios.post(url, { events }, { headers: { "Content-Type": "application/json", ...headers }, timeout: 3000 });
  }
}

/** Fired synchronously from services/auditLog.ts for every audit write. */
export async function dispatchRealtimeLogExports(workspaceSlug: string, events: AuditEventLike[]): Promise<void> {
  if (!events.length) return;
  let destinations;
  try {
    destinations = await prisma.logExportDestination.findMany({
      where: { workspaceSlug, enabled: true, type: { in: [...LOG_EXPORT_REALTIME_TYPES] as string[] } },
    });
  } catch (e) {
    console.warn(`[Log Export] Failed to load real-time destinations for ${workspaceSlug}: ${e}`);
    return;
  }
  for (const dest of destinations) {
    try {
      const cfg = decryptConfig(dest.type, (dest.config as Record<string, any>) ?? {});
      const fmt = dest.format || "json";
      if (dest.type === "syslog") await sendSyslog(cfg, events, fmt);
      else if (dest.type === "webhook") await sendWebhook(cfg, events, fmt);
    } catch (e) {
      console.warn(`[Log Export] '${dest.name}' (${dest.type}) delivery failed: ${e}`);
    }
  }
}

// ── Batch exporters (s3/nfs/sftp) ──

async function exportToS3(config: Record<string, any>, filename: string, content: Buffer): Promise<void> {
  const bucket = config?.bucket;
  if (!bucket) throw new Error("S3 destination has no bucket configured");
  const client = new S3Client({
    region: config?.region || "us-east-1",
    endpoint: config?.endpointUrl || undefined,
    forcePathStyle: Boolean(config?.endpointUrl),
    credentials: config?.accessKeyId && config?.secretAccessKey
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : undefined,
  });
  const key = `${String(config?.prefix ?? "").replace(/^\/+|\/+$/g, "")}/${filename}`.replace(/^\/+/, "");
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: "application/json" }));
}

/** "NFS" here just means a local directory, same as the original — the actual mount is a docker-compose/host concern. */
async function exportToNfs(config: Record<string, any>, filename: string, content: Buffer): Promise<void> {
  const dirPath = config?.path;
  if (!dirPath) throw new Error("NFS destination has no path configured");
  await mkdir(dirPath, { recursive: true });
  await writeFile(path.join(dirPath, filename), content);
}

async function exportToSftp(config: Record<string, any>, filename: string, content: Buffer): Promise<void> {
  const host = config?.host;
  if (!host) throw new Error("SFTP destination has no host configured");
  const client = new SftpClient();
  try {
    await client.connect({
      host, port: Number(config?.port) || 22, username: config?.username,
      password: config?.privateKey ? undefined : config?.password,
      privateKey: config?.privateKey || undefined,
      passphrase: config?.privateKeyPassphrase || undefined,
    });
    const remotePath = `${String(config?.remotePath ?? "/").replace(/\/+$/, "")}/${filename}`;
    await client.put(content, remotePath);
  } finally {
    await client.end().catch(() => {});
  }
}

async function runBatchExport(type: string, config: Record<string, any>, filename: string, content: Buffer): Promise<void> {
  if (type === "s3") return exportToS3(config, filename, content);
  if (type === "nfs") return exportToNfs(config, filename, content);
  if (type === "sftp") return exportToSftp(config, filename, content);
  throw new Error(`Unknown destination type '${type}'`);
}

function slugClean(slug: string): string {
  return (slug || "global").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Sends one synthetic event through the destination right now — port of `test_log_export_destination` (main.py:2363). */
export async function testLogExportDestination(workspaceSlug: string, id: string, actor: string): Promise<void> {
  const dest = await prisma.logExportDestination.findFirst({ where: { id, workspaceSlug } });
  if (!dest) throw new HttpError(404, "Destination not found");
  const testEvent: AuditEventLike = {
    id: "test", timestamp: new Date().toISOString(), category: "settings", action: "log_export_test",
    severity: "info", actor, targetType: null, targetId: null, targetName: null,
    message: `Test event from SOAR — destination "${dest.name}" is working.`,
  };
  const cfg = decryptConfig(dest.type, (dest.config as Record<string, any>) ?? {});
  const fmt = dest.format || "json";
  try {
    if (dest.type === "syslog") await sendSyslog(cfg, [testEvent], fmt);
    else if (dest.type === "webhook") await sendWebhook(cfg, [testEvent], fmt);
    else if ((LOG_EXPORT_BATCH_TYPES as readonly string[]).includes(dest.type)) {
      const content = Buffer.from(JSON.stringify([testEvent], null, 2), "utf-8");
      await runBatchExport(dest.type, cfg, `test-${Date.now()}.json`, content);
    } else {
      throw new Error(`Unknown destination type '${dest.type}'`);
    }
  } catch (e) {
    throw new HttpError(502, `Test delivery failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Once-a-day batch shipment — port of `log_export_scheduler_loop`
 * (main.py:2228). Each destination tracks its own `lastExportedAt` cursor
 * independently, so adding a second destination doesn't re-send everything
 * already delivered to the first, and a destination that starts failing
 * keeps retrying the same backlog on the next tick.
 */
export async function runLogExportSchedulerTick(): Promise<void> {
  const destinations = await prisma.logExportDestination.findMany({
    where: { enabled: true, type: { in: [...LOG_EXPORT_BATCH_TYPES] as string[] } },
  });
  const byWorkspace = new Map<string, typeof destinations>();
  for (const d of destinations) {
    if (!byWorkspace.has(d.workspaceSlug)) byWorkspace.set(d.workspaceSlug, []);
    byWorkspace.get(d.workspaceSlug)!.push(d);
  }

  for (const [workspaceSlug, dests] of byWorkspace) {
    for (const dest of dests) {
      try {
        const newEntries = await prisma.auditLogEntry.findMany({
          where: { workspaceSlug, ...(dest.lastExportedAt ? { createdAt: { gt: dest.lastExportedAt } } : {}) },
          orderBy: { createdAt: "asc" },
        });
        if (!newEntries.length) continue;
        const events: AuditEventLike[] = newEntries.map((e) => ({
          id: e.id, timestamp: e.createdAt.toISOString(), category: e.category, action: e.action,
          severity: e.severity, actor: e.actor, targetType: e.targetType, targetId: e.targetId,
          targetName: e.targetName, message: e.message,
        }));
        const filename = `audit-log-${slugClean(workspaceSlug)}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z")}.json`;
        const content = Buffer.from(JSON.stringify(events, null, 2), "utf-8");
        const cfg = decryptConfig(dest.type, (dest.config as Record<string, any>) ?? {});
        await runBatchExport(dest.type, cfg, filename, content);
        await prisma.logExportDestination.update({
          where: { id: dest.id },
          data: { lastExportedAt: newEntries[newEntries.length - 1].createdAt, lastExportError: null },
        });
        console.log(`[Log Export] '${dest.name}' (${workspaceSlug}): shipped ${events.length} event(s)`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await prisma.logExportDestination.update({ where: { id: dest.id }, data: { lastExportError: message } }).catch(() => {});
        console.warn(`[Log Export] '${dest.name}' (${workspaceSlug}) failed: ${message}`);
      }
    }
  }
}
