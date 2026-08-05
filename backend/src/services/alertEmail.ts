import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { decryptSmtpConfig } from "./smtpConfig";

/**
 * Best-effort email alert using the deployment's SMTP config (Settings >
 * Email (SMTP)). Port of `_send_alert_email` (main.py:13502-13530). A
 * no-op (not an error) when SMTP or recipients aren't configured yet —
 * email is one of several alert channels, never the only one blocking on
 * this working.
 *
 * SMTP config always lives on the WorkspaceState row keyed "global" —
 * Settings > General/SMTP is a single deployment-wide config, not
 * per-workspace (dashboardState.ts's GLOBAL_HEADERS convention: the
 * frontend always sends X-Workspace-Slug: global for GET/POST /api/state,
 * so no other row is ever created). This previously looked the row up
 * under whichever `workspaceSlug` the caller happened to pass — harmless
 * from systemHealth.service.ts (which does pass "global" explicitly), but
 * a silent no-op from integrations.service.ts's Case SLA breach alert
 * (which passes the case's REAL workspace slug): `findUnique` returned
 * null for any workspace slug other than literally "global", so
 * `smtpConfig` fell through to `{}` and this returned early every time,
 * with nothing logged — SLA breach emails simply never sent in any
 * multi-workspace deployment. `workspaceSlug` is kept in the signature
 * (still useful context for the caller, and avoids touching every call
 * site) but is no longer used for this lookup.
 */
export async function sendAlertEmail(workspaceSlug: string, subject: string, bodyText: string, recipientsOverride?: string | null): Promise<void> {
  void workspaceSlug; // kept for caller context/API stability; SMTP config lookup below is always the "global" row, see doc comment above
  try {
    const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug: "global" } });
    const smtpConfig = decryptSmtpConfig(state?.smtpConfig as Record<string, any>) ?? {};
    const recipients: string | undefined = recipientsOverride || smtpConfig.alertRecipients;
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
