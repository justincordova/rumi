import { env } from "@/lib/env";
import type { Channel } from "./unsubscribe";
import { signUnsubscribeToken } from "./unsubscribe";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip everything that breaks an HTML attribute. URLs go straight into
 *  href="..." so an unescaped quote could end the attribute and inject
 *  arbitrary HTML. Defense-in-depth — current inputs are server-controlled. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function sanitizeSubject(s: string): string {
  return s.replace(/[\r\n]/g, "");
}

function buildUnsubUrl(userId: string, channel: Channel): string | null {
  if (userId === "anon") return null;
  const token = signUnsubscribeToken(userId, channel);
  if (!token) return null;
  return `${env.PUBLIC_API_URL}/api/notifications/unsubscribe?token=${token}`;
}

function renderHtml(opts: {
  heading: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
  unsubChanUrl: string | null;
}) {
  const ctaUrl = escapeAttr(opts.ctaUrl);
  const unsubSection = opts.unsubChanUrl
    ? `<a href="${escapeAttr(opts.unsubChanUrl)}" style="color:#6b7280">Unsubscribe from these emails</a>.`
    : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="padding:32px 40px">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111827">${opts.heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">${opts.body}</p>
      <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">${opts.ctaLabel}</a>
      <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5">
        You received this because you have email notifications enabled.
        ${unsubSection}
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

// Caps to prevent a hostile display name from producing an oversized subject
// header (most MTAs reject >998 bytes per RFC 5322) or a runaway HTML heading.
const NAME_CAP = 80;
const ROOM_CAP = 120;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function accessGrantedTemplate(opts: {
  toUserId: string;
  granterName: string;
  roomName: string;
  roomSlug: string;
}) {
  const granterName = truncate(opts.granterName, NAME_CAP);
  const roomName = truncate(opts.roomName, ROOM_CAP);
  const url = `${env.WEB_URL}/r/${opts.roomSlug}`;
  const unsubChan = buildUnsubUrl(opts.toUserId, "room_access_granted");
  const unsubAll = buildUnsubUrl(opts.toUserId, "all");
  const escapedGranter = escapeHtml(granterName);
  const escapedRoom = escapeHtml(roomName);
  const subject = sanitizeSubject(`${granterName} gave you access to a room on Rumi`);
  const text = `${granterName} gave you access to "${roomName}" on Rumi.\n\nOpen the room: ${url}\n\nIf you weren't expecting this, you can ignore this email.\n\nManage email preferences: ${env.WEB_URL}/settings?tab=general${unsubChan ? `\nUnsubscribe from access emails: ${unsubChan}` : ""}`;
  const html = renderHtml({
    heading: escapedGranter
      ? `${sanitizeSubject(escapedGranter)} gave you access to a room on Rumi`
      : "You were given access to a room on Rumi",
    body: `${escapedGranter} gave you access to "${escapedRoom}".`,
    ctaUrl: url,
    ctaLabel: "Open room",
    unsubChanUrl: unsubChan,
  });
  return { subject, text, html, listUnsubscribe: unsubAll ?? undefined };
}
