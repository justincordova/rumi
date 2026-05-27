import { db } from "@/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { type NotificationsService, createNotificationsService } from "@/notifications/service";
import { Resend } from "resend";
import { accessGrantedTemplate } from "./templates";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lazy module-scope cache so we don't reinstantiate the service per-email.
// `createNotificationsService(db)` only closes over `db` and returns a method
// bag, so caching is cheap and safe.
let _notifSvc: NotificationsService | null = null;
function notifSvc(): NotificationsService {
  if (!_notifSvc) _notifSvc = createNotificationsService(db);
  return _notifSvc;
}

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
  // For email-only invites the recipient has no Rumi account yet, so we
  // pass `toUserId: "anon"`. `notification_preferences.user_id` is a UUID
  // column — querying it with the string "anon" would produce a Postgres
  // syntax error, our .catch would null prefs, and the email would be
  // silently dropped. That's the WORST recipient to drop the email on.
  //
  // Callers MUST do their own preference check for known users (see
  // rooms/service.ts:addToWhitelist). The guard here is purely a
  // belt-and-braces in case a caller forgets — only run it when toUserId
  // looks like a real user id.
  if (UUID_RE.test(opts.toUserId)) {
    const prefs = await notifSvc()
      .getPreferences(opts.toUserId)
      .catch((err) => {
        logger.warn({ err, toUserId: opts.toUserId }, "preference lookup failed; skipping email");
        return null;
      });
    if (!prefs) return;
    if (!prefs.emailEnabled || !prefs.accessGrantedEmail) {
      logger.debug({ toUserId: opts.toUserId }, "access-granted email skipped by user prefs");
      return;
    }
  }
  const { toEmail, ...templateOpts } = opts;
  return send({ to: toEmail, ...accessGrantedTemplate(templateOpts) });
}
