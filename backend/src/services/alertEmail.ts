import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { decryptSmtpConfig } from "./smtpConfig";

/**
 * Best-effort email alert using the workspace's SMTP config (Settings >
 * Email (SMTP), stored on WorkspaceState — Phase 7's /api/state owns
 * writing it, this only reads). Port of `_send_alert_email`
 * (main.py:13502-13530). A no-op (not an error) when SMTP or
 * alertRecipients aren't configured yet — email is one of several alert
 * channels, never the only one blocking on this working.
 */
export async function sendAlertEmail(workspaceSlug: string, subject: string, bodyText: string): Promise<void> {
  try {
    const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
    const smtpConfig = decryptSmtpConfig(state?.smtpConfig as Record<string, any>) ?? {};
    const recipients: string | undefined = smtpConfig.alertRecipients;
    if (!smtpConfig.host || !smtpConfig.user || !recipients) return;

    const port = Number(smtpConfig.port) || 587;
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port,
      secure: port === 465,
      auth: { user: smtpConfig.user, pass: smtpConfig.pass || "" },
    });
    await transporter.sendMail({
      from: smtpConfig.from || smtpConfig.user,
      to: recipients,
      subject,
      text: bodyText,
    });
  } catch (e) {
    console.warn(`[Alert Email] Failed to send '${subject}': ${e}`);
  }
}
