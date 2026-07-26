import nodemailer from "nodemailer";
import { HttpError } from "../../utils/httpError";

/**
 * Port of `test_smtp` (main.py:1913-1937) — sends one real test email using
 * whatever SMTP settings the admin has typed into the form right now
 * (not yet persisted; full SMTP settings persistence arrives with Phase 7's
 * /api/state). nodemailer here plays the same role as Python's smtplib +
 * EmailMessage.
 */
export interface SmtpTestConfig {
  host?: string;
  port?: string | number;
  user?: string;
  pass?: string;
  from?: string;
}

export async function testSmtp(smtpConfig: SmtpTestConfig, testRecipient: string): Promise<void> {
  if (!smtpConfig?.host || !smtpConfig?.user) {
    throw new HttpError(400, "Incomplete SMTP configuration. Host and Username required.");
  }
  const port = Number(smtpConfig.port) || 587;
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port,
    secure: port === 465,
    auth: smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.pass || "" } : undefined,
  });
  try {
    await transporter.sendMail({
      from: smtpConfig.from || smtpConfig.user,
      to: testRecipient,
      subject: "Applivery Dashboard - SMTP Connection Test",
      text: "This is a test email from your Applivery SOAR dashboard's SMTP settings. If you received this, the connection is working.",
    });
  } catch (e) {
    throw new HttpError(502, `Failed to send test email: ${e instanceof Error ? e.message : e}`);
  }
}
