import axios from "axios";
import { HttpError } from "../../utils/httpError";

/**
 * Posts a plain text message to a chat webhook — the shared shape
 * Settings > General's "Notifications Webhook URL" and Compliance Policy's
 * own per-policy alertWebhookUrl override both point at. Accepts both
 * Google Chat and Slack incoming-webhook URLs since both speak the same
 * `{"text": "..."}` POST protocol. reports.service.ts's
 * sendGoogleChatWebhook posts a richer cardsV2 payload for actual report
 * delivery instead — kept separate since that one is deliberately
 * "best-effort, never throws" (a scheduled job, no one waiting on the
 * result), while this one always throws on failure so callers that DO
 * want to know (the Test button below, a policy alert wanting to record
 * lastAlertError) can.
 */
export async function sendChatText(webhookUrl: string, text: string): Promise<void> {
  const res = await axios.post(webhookUrl, { text }, { headers: { "Content-Type": "application/json" }, validateStatus: () => true });
  // Logged unconditionally (not just on failure) — this is the only way to
  // see what the remote endpoint actually returned, since a webhook that
  // replies HTTP 200 with an unexpected body (or that silently redirects,
  // or that returns a body we don't yet recognize as an error) wouldn't
  // otherwise leave any trace. Host-only, no token/path, to avoid leaking
  // the webhook secret into logs.
  try {
    const u = new URL(webhookUrl);
    console.log(
      `[notificationsWebhook] POST ${u.host} -> HTTP ${res.status}` +
        `${res.request?.res?.responseUrl && res.request.res.responseUrl !== webhookUrl ? ` (redirected to ${new URL(res.request.res.responseUrl).host})` : ""}` +
        ` content-type=${res.headers?.["content-type"] || "?"} body=${JSON.stringify(res.data).slice(0, 300)}`,
    );
  } catch {
    // best-effort diagnostic logging only — never let it block delivery
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`webhook returned ${res.status}${res.data ? `: ${JSON.stringify(res.data).slice(0, 200)}` : ""}`);
  }
  // Slack's incoming webhooks respond HTTP 200 with a *plain-text* body of
  // "ok" on genuine delivery — but several failure modes (revoked token,
  // channel archived/deleted, app uninstalled from the workspace) are ALSO
  // reported as HTTP 200, just with a different plain-text body instead of
  // an error status code. Without this check those failures were silently
  // reported to the user as "sent successfully". Google Chat responds with
  // a JSON object on success, so this only engages for Slack-style
  // plain-text responses and doesn't affect Google Chat webhooks.
  if (typeof res.data === "string") {
    const body = res.data.trim();
    if (body !== "ok" && body.length > 0 && body.length < 200) {
      throw new Error(`webhook accepted the request (HTTP 200) but reported: "${body}"`);
    }
  }
}

/**
 * "Test" button for Settings > General's "Notifications Webhook URL" —
 * mirrors smtp.service.ts's testSmtp: sends one real test message to
 * whatever URL is currently typed into the form right now (not yet saved),
 * so an admin can confirm delivery before hitting Save.
 */
export async function testNotificationsWebhook(webhookUrl: string): Promise<void> {
  if (!webhookUrl || !webhookUrl.trim()) {
    throw new HttpError(400, "Enter a webhook URL first.");
  }
  try {
    await sendChatText(webhookUrl, "✅ Test message from your Applivery SOAR dashboard. If you're seeing this, the Notifications Webhook URL is working.");
  } catch (e) {
    throw new HttpError(502, `Failed to reach the webhook: ${e instanceof Error ? e.message : e}`);
  }
}
