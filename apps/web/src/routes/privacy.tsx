import logoT from "@/assets/logos/logo-t.png";
import { useSeoMeta } from "@/lib/seo";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  useSeoMeta({
    title: "Privacy Policy — Rumi",
    description: "How Rumi collects, uses, and protects your data.",
    canonical: "/privacy",
    noindex: false,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoT} alt="Rumi" className="h-5 w-5" />
            <span className="font-display text-sm font-semibold tracking-tight">Rumi</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link
              to="/sign-in"
              search={{ next: "/dashboard" }}
              className="hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-10">
        <article className="prose-document">
          <h1>Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: 2026-05-03</p>

          <p>
            This Privacy Policy describes how Rumi ("we", "us", "our") collects, uses, and protects
            information about you when you use our service. By using Rumi you agree to the practices
            described below.
          </p>

          <h2>1. Information we collect</h2>
          <p>
            <strong>Account information.</strong> When you sign in with a supported OAuth provider
            (Google, GitHub) we receive your name, email address, profile picture, and a stable
            provider identifier. We store this through our authentication provider (Supabase).
          </p>
          <p>
            <strong>Content you create.</strong> Documents, drawings, room names, tab names, and any
            text you type into Rumi are stored on our servers and replicated to other room members
            in real time.
          </p>
          <p>
            <strong>Billing information.</strong> If you subscribe to a paid plan, payment is
            processed by Stripe. We never see or store your card number; we only store a Stripe
            customer ID and subscription metadata.
          </p>
          <p>
            <strong>Operational logs.</strong> We log requests, errors, and basic usage metrics
            (room counts, connection events) for the purpose of running and securing the service.
            Logs are retained for up to 30 days.
          </p>
          <p>
            <strong>Analytics.</strong> If you consent to analytics cookies, we use Plausible
            (privacy-friendly, no personal data) to understand which pages people visit. See the{" "}
            <a href="#cookies">Cookies</a> section below.
          </p>

          <h2>2. How we use your information</h2>
          <ul>
            <li>To provide the collaborative editing service you signed up for.</li>
            <li>
              To send transactional emails — for example, when someone gives you access to a room.
              You can disable these in your notification preferences.
            </li>
            <li>To process payments and manage subscriptions.</li>
            <li>To detect abuse, debug issues, and keep the service running.</li>
          </ul>
          <p>
            We do not sell your personal information. We do not use your content to train AI models.
          </p>

          <h2>3. How we share information</h2>
          <p>We share data only with the providers required to run Rumi:</p>
          <ul>
            <li>
              <strong>Supabase</strong> — authentication and database hosting.
            </li>
            <li>
              <strong>Stripe</strong> — payment processing.
            </li>
            <li>
              <strong>Resend</strong> — transactional email delivery.
            </li>
            <li>
              <strong>Plausible</strong> — privacy-friendly web analytics (only if you consent).
            </li>
          </ul>
          <p>
            Each of these providers has access only to the data needed for their function, and is
            bound by their own privacy and security commitments.
          </p>

          <h2>4. Other room members</h2>
          <p>
            Rumi is a collaborative product. When you join a room, other members of that room can
            see your display name, avatar, cursor position, and any content you contribute to the
            room. Your email address is shown only to room owners and admins on the members list.
          </p>

          <h2>5. Data retention and deletion</h2>
          <p>
            You can delete your account at any time from Settings → Account. When you do, we
            soft-delete any rooms you solely own (they are permanently purged after 30 days), remove
            you from rooms you are a member of, and request deletion of your authentication record.
            Rooms with co-owners or co-members are not deleted because they belong to the group.
          </p>
          <p>
            Deleted rooms are kept in trash for 30 days so they can be restored, then permanently
            purged.
          </p>

          <h2>6. Security</h2>
          <p>
            All traffic is encrypted in transit (TLS). Authentication tokens are short-lived JWTs.
            Passwords are never seen by us — sign-in goes through OAuth providers.
          </p>

          <h2>7. Your rights</h2>
          <p>
            Depending on where you live, you may have the right to access, correct, export, or
            delete your personal information. Email us at{" "}
            <a href="mailto:privacy@rumi.app">privacy@rumi.app</a> and we will respond within 30
            days.
          </p>

          <h2 id="cookies">8. Cookies</h2>
          <p>Rumi uses two categories of cookies:</p>
          <ul>
            <li>
              <strong>Necessary.</strong> Required for sign-in, session management, and remembering
              your theme and consent choice. Always on; cannot be disabled.
            </li>
            <li>
              <strong>Analytics.</strong> Loads the Plausible analytics script, which counts page
              views without using personal data, third-party trackers, or cross-site identifiers.
              Off by default; only loads if you accept.
            </li>
          </ul>
          <p>
            You can update your choice at any time from the "Cookies" link in the footer of the
            landing page.
          </p>

          <h2>9. Children</h2>
          <p>
            Rumi is not directed at children under 13. If we learn that we have collected
            information from a child under 13, we will delete it.
          </p>

          <h2>10. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The "Last updated" date at the top
            of this page reflects the most recent revision. Material changes will be announced via
            email or in-app notification.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions? Email <a href="mailto:privacy@rumi.app">privacy@rumi.app</a>.
          </p>
        </article>
      </main>
    </div>
  );
}
