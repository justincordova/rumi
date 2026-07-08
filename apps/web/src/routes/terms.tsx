import logoT from "@/assets/logos/logo-t.png";
import { useSeoMeta } from "@/lib/seo";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  useSeoMeta({
    title: "Terms of Service",
    description: "The agreement between you and Rumi when you use the service.",
    canonical: "/terms",
    noindex: false,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <img src={logoT} alt="Rumi" className="h-5 w-5" />
            <span className="font-display text-sm font-semibold tracking-tight">Rumi</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link
              to="/privacy"
              className="rounded-sm hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Privacy
            </Link>
            <Link
              to="/sign-in"
              search={{ next: "/dashboard" }}
              className="rounded-sm hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-10">
        <article className="prose-document">
          <h1>Terms of Service</h1>
          <p className="text-sm text-muted-foreground">Last updated: 2026-05-03</p>

          <p>
            These Terms of Service ("Terms") govern your access to and use of Rumi ("Service"). By
            creating an account or using the Service, you agree to these Terms.
          </p>

          <h2>1. Eligibility</h2>
          <p>
            You must be at least 13 years old to use Rumi. If you are using Rumi on behalf of an
            organization, you represent that you have the authority to bind that organization to
            these Terms.
          </p>

          <h2>2. Your account</h2>
          <p>
            You are responsible for keeping your authentication credentials secure and for all
            activity that occurs under your account. Notify us immediately at{" "}
            <a href="mailto:security@rumi.app">security@rumi.app</a> if you suspect unauthorized
            access.
          </p>

          <h2>3. Acceptable use</h2>
          <p>You agree not to use Rumi to:</p>
          <ul>
            <li>Violate any law or third-party rights, including intellectual property.</li>
            <li>
              Distribute malware, conduct phishing, or use the Service as part of an attack on
              another system.
            </li>
            <li>Harass, threaten, or impersonate other people.</li>
            <li>
              Attempt to disrupt the Service, bypass plan limits, or gain unauthorized access to
              data.
            </li>
            <li>Mine cryptocurrency or perform other resource-abusive computation.</li>
          </ul>
          <p>We may suspend or terminate accounts that violate this section.</p>

          <h2>4. Your content</h2>
          <p>
            You retain ownership of the content you create in Rumi. By using the Service you grant
            us a limited license to host, store, transmit, and display that content solely as needed
            to operate the Service.
          </p>
          <p>
            You are responsible for your content. We do not pre-screen content but may remove
            content that we reasonably believe violates these Terms.
          </p>

          <h2>5. Subscriptions and billing</h2>
          <p>
            Paid plans (Pro, Max) are billed in advance on a monthly or yearly basis through our
            payment processor, Stripe. By subscribing you authorize recurring charges to your
            payment method until you cancel.
          </p>
          <p>
            <strong>All sales are final. We do not offer refunds.</strong> You may cancel your
            subscription at any time; access to paid features continues through the end of the
            current billing period, after which your account reverts to the Free plan.
          </p>
          <p>
            We may change subscription prices with at least 30 days' notice to active subscribers.
            Continued use after the change takes effect constitutes acceptance.
          </p>

          <h2>6. Plan limits</h2>
          <p>
            Each plan has documented limits on rooms, tabs, and concurrent users. We enforce these
            limits server-side. If you reach a limit, the corresponding action is blocked until you
            upgrade or free up space.
          </p>

          <h2>7. Service availability</h2>
          <p>
            We aim for high availability but make no uptime guarantee. The Service is provided "as
            is" without warranties of any kind, express or implied, including merchantability,
            fitness for a particular purpose, and non-infringement.
          </p>

          <h2>8. Termination</h2>
          <p>
            You may stop using Rumi at any time and delete your account from Settings → Account. We
            may suspend or terminate accounts that violate these Terms or that we reasonably believe
            pose a risk to the Service or to other users. On termination, your access ends; your
            content may be deleted as described in our <Link to="/privacy">Privacy Policy</Link>.
          </p>

          <h2>9. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Rumi and its operators are not liable for any
            indirect, incidental, special, consequential, or punitive damages arising out of or in
            connection with your use of the Service. Our total liability for any claim related to
            the Service will not exceed the amount you paid us in the 12 months preceding the claim,
            or USD $50 if you are a Free user.
          </p>

          <h2>10. Indemnification</h2>
          <p>
            You agree to indemnify and hold us harmless from claims, damages, and expenses
            (including reasonable legal fees) arising out of your content, your use of the Service,
            or your violation of these Terms.
          </p>

          <h2>11. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. The "Last updated" date at the top of this
            page reflects the most recent revision. Material changes will be announced via email or
            in-app notification at least 30 days before they take effect for paying users.
          </p>

          <h2>12. Governing law</h2>
          <p>
            These Terms are governed by the laws of the State of California, USA, without regard to
            its conflict-of-law principles. Disputes will be resolved in the state and federal
            courts located in San Francisco County, California.
          </p>

          <h2>13. Contact</h2>
          <p>
            Questions? Email <a href="mailto:legal@rumi.app">legal@rumi.app</a>.
          </p>
        </article>
      </main>
    </div>
  );
}
