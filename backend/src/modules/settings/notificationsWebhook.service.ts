import axios from "axios";
import { HttpError } from "../../utils/httpError";

/**
 * "Test" button for Settings > General's "Notifications Webhook URL" —
 * mirrors smtp.service.ts's testSmtp: sends one real test message to
 * whatever URL is currently typed into the form right now (not yet saved),
 * so an admin can confirm delivery before hitting Save. This URL is a
 * Google Chat space webhook (see GeneralSettingsForm.vue's own
 * placeholder/help text) — reports.service.ts's sendGoogleChatWebhook
 * posts a richer cardsV2 payload for actual report delivery and is
 * deliberately "best-effort, never throws"; this one is the opposite on
 * purpose (a user just clicked a button and is waiting for a pass/fail),
 * so it throws on any non-2xx response or network failure instead of
 * swallowing it.
 */
export async function testNotificationsWebhook(webhookUrl: string): Promise<void> {
  if (!webhookUrl || !webhookUrl.trim()) {
    throw new HttpError(400, "Enter a webhook URL first.");
  }
  const payload = { text: "✅ Test message from your Applivery SOAR dashboard. If you're seeing this, the Notifications Webhook URL is working." };
  try {
    const res = await axios.post(webhookUrl, payload, { headers: { "Content-Type": "application/json" }, validateStatus: () => true });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`webhook returned ${res.status}${res.data ? `: ${JSON.stringify(res.data).slice(0, 200)}` : ""}`);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Failed to reach the webhook: ${e instanceof Error ? e.message : e}`);
  }
}
