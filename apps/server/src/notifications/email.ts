import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
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
  // Callers are responsible for checking user notification preferences
  // before invoking — see rooms/service.ts:addToWhitelist where prefs are
  // consulted via `deps.notifications.getPreferences` for known users.
  // Email-only invites (toUserId === "anon") have no Rumi account yet so
  // no prefs row to consult; the email itself is the user's first contact
  // with the product and must always go out.
  //
  // Email.ts deliberately does NOT import the notifications service to
  // avoid pulling the full DB schema dependency graph into the test path,
  // which Bun's ESM evaluation order trips on (cyclic-import quirk).
  const { toEmail, ...templateOpts } = opts;
  return send({ to: toEmail, ...accessGrantedTemplate(templateOpts) });
}
