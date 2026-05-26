import { db } from "@/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createNotificationsService } from "@/notifications/service";
import { Resend } from "resend";
import { accessGrantedTemplate } from "./templates";

let _resend: Resend | null = null;
function getResend() {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

/** Redact a recipient address for logging: keep the first 2 chars + domain. */
function maskEmail(addr: string): string {
  const at = addr.indexOf("@");
  if (at <= 0) return "***";
  const local = addr.slice(0, at);
  const domain = addr.slice(at);
  return `${local.slice(0, 2)}***${domain}`;
}

async function send(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  listUnsubscribe?: string;
}) {
  if (!opts.to) {
    logger.warn({ subject: opts.subject }, "email skipped: empty to address");
    return;
  }
  const maskedTo = maskEmail(opts.to);
  const resend = getResend();
  if (!resend) {
    logger.info({ to: maskedTo, subject: opts.subject }, "email (stub): would send");
    return;
  }
  try {
    const headers: Record<string, string> = {};
    if (opts.listUnsubscribe) {
      headers["List-Unsubscribe"] = `<${opts.listUnsubscribe}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    await resend.emails.send({
      from: env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
  } catch (err) {
    logger.error({ err, to: maskedTo }, "email send failed");
  }
}

export async function sendAccessGrantedEmail(opts: {
  toUserId: string;
  toEmail: string;
  granterName: string;
  roomName: string;
  roomSlug: string;
}) {
  // Honor user notification preferences. Previously the email fired
  // unconditionally — users who unsubscribed via the prefs API kept receiving
  // these, violating CAN-SPAM / GDPR.
  const prefs = await createNotificationsService(db)
    .getPreferences(opts.toUserId)
    .catch((err) => {
      // If preference lookup fails, default to *not* sending — fail closed
      // for compliance, not opening.
      logger.warn({ err, toUserId: opts.toUserId }, "preference lookup failed; skipping email");
      return null;
    });
  if (!prefs) return;
  if (!prefs.emailEnabled || !prefs.accessGrantedEmail) {
    logger.debug({ toUserId: opts.toUserId }, "access-granted email skipped by user prefs");
    return;
  }
  const { toEmail, ...templateOpts } = opts;
  return send({ to: toEmail, ...accessGrantedTemplate(templateOpts) });
}
