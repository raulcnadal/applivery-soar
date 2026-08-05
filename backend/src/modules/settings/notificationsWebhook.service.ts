import axios from "axios";
import { HttpError } from "../../utils/httpError";

/**
 * Posts a plain text message to a Google Chat space webhook — the shared
 * shape Settings > General's "Notifications Webhook URL" and Compliance
 * Policy's own per-policy alertWebhookUrl override both point at.
 * reports.service.ts's sendGoogleChatWebhook posts a richer cardsV2
 * payload for actual report delivery instead — kept separate since that
 * one is deliberately "best-effort, never throws" (a scheduled job, no one
 * waiting on the result), while this one always throws on a non-2xx
 * response or network failure so callers that DO want to know (the Test
 * button below, a policy alert wanting to record lastAlertError) can.
 */
export async function sendChatText(webhookUrl: string, text: string): Promise<void> {
  const res = await axios.post(webhookUrl, { text }, { headers: { "Content-Type": "application/json" }, validateStatus: () => true });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`webhook returned ${res.status}${res.data ? `: ${JSON.stringify(res.data).slice(0, 200)}` : ""}`);
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
