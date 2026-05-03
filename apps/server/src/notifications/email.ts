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
  const resend = getResend();
  if (!resend) {
    logger.info({ to: opts.to, subject: opts.subject }, "email (stub): would send");
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
    logger.error({ err, to: opts.to }, "email send failed");
  }
}

export async function sendAccessGrantedEmail(opts: {
  toUserId: string;
  toEmail: string;
  granterName: string;
  roomName: string;
  roomSlug: string;
}) {
  const { toEmail, ...templateOpts } = opts;
  return send({ to: toEmail, ...accessGrantedTemplate(templateOpts) });
}
