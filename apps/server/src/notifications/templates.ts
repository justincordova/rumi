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
  const unsubSection = opts.unsubChanUrl
    ? `<a href="${opts.unsubChanUrl}" style="color:#6b7280">Unsubscribe from these emails</a>.`
    : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="padding:32px 40px">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111827">${opts.heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">${opts.body}</p>
      <a href="${opts.ctaUrl}" style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">${opts.ctaLabel}</a>
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

export function inviteReceivedTemplate(opts: {
  toUserId: string;
  inviterName: string;
  roomName: string;
  roomSlug: string;
}) {
  const url = `${env.WEB_URL}/r/${opts.roomSlug}`;
  const unsubChan = buildUnsubUrl(opts.toUserId, "invite_received");
  const unsubAll = buildUnsubUrl(opts.toUserId, "all");
  const escapedInviter = escapeHtml(opts.inviterName);
  const escapedRoom = escapeHtml(opts.roomName);
  const subject = sanitizeSubject(`${opts.inviterName} invited you to a room on Rumi`);
  const text = `${opts.inviterName} invited you to "${opts.roomName}" on Rumi.\n\nOpen the room: ${url}\n\nIf you weren't expecting this, you can ignore this email.\n\nManage email preferences: ${env.WEB_URL}/settings?tab=general${unsubChan ? `\nUnsubscribe from invite emails: ${unsubChan}` : ""}`;
  const html = renderHtml({
    heading: escapedInviter
      ? `${sanitizeSubject(escapedInviter)} invited you to a room on Rumi`
      : "You were invited to a room on Rumi",
    body: `${escapedInviter} invited you to "${escapedRoom}".`,
    ctaUrl: url,
    ctaLabel: "Open room",
    unsubChanUrl: unsubChan,
  });
  return { subject, text, html, listUnsubscribe: unsubAll ?? undefined };
}

export function inviteAcceptedTemplate(opts: {
  toUserId: string;
  accepterName: string;
  roomName: string;
  roomSlug: string;
}) {
  const url = `${env.WEB_URL}/r/${opts.roomSlug}`;
  const unsubChan = buildUnsubUrl(opts.toUserId, "invite_accepted");
  const unsubAll = buildUnsubUrl(opts.toUserId, "all");
  const escapedAccepter = escapeHtml(opts.accepterName ?? "Someone");
  const escapedRoom = escapeHtml(opts.roomName);
  const subject = sanitizeSubject(
    `${opts.accepterName ?? "Someone"} joined your room "${opts.roomName}"`,
  );
  const text = `${opts.accepterName ?? "Someone"} accepted your invite to "${opts.roomName}".\n\nOpen the room: ${url}\n\nManage email preferences: ${env.WEB_URL}/settings?tab=general${unsubChan ? `\nUnsubscribe from these emails: ${unsubChan}` : ""}`;
  const html = renderHtml({
    heading: sanitizeSubject(`${escapedAccepter} joined your room "${escapedRoom}"`),
    body: `${escapedAccepter} accepted your invite to "${escapedRoom}".`,
    ctaUrl: url,
    ctaLabel: "Open room",
    unsubChanUrl: unsubChan,
  });
  return { subject, text, html, listUnsubscribe: unsubAll ?? undefined };
}
