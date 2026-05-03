import logoT from "@/assets/logos/logo-t.png";
import { Button } from "@/components/ui/button";
import { signInWithProvider } from "@/lib/auth";
import { useSeoMeta } from "@/lib/seo";
import { createFileRoute } from "@tanstack/react-router";
import { FaGithub as FaGithubRaw } from "react-icons/fa6";
import { FcGoogle as FcGoogleRaw } from "react-icons/fc";

// react-icons' IconBaseProps extends React.SVGAttributes<SVGElement> but the
// type-resolution chain in this monorepo (mixed @types/react versions) loses
// the className prop. Re-type with a simple SVG-attributes shape.
type IconProps = { className?: string };
// biome-ignore lint/suspicious/noExplicitAny: cross-package type drift workaround
const FaGithub = FaGithubRaw as unknown as (props: IconProps) => any;
// biome-ignore lint/suspicious/noExplicitAny: cross-package type drift workaround
const FcGoogle = FcGoogleRaw as unknown as (props: IconProps) => any;

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
  validateSearch: (s) => ({ next: typeof s.next === "string" ? s.next : "/dashboard" }),
});

function SignInPage() {
  const { next } = Route.useSearch();
  useSeoMeta({
    title: "Sign in — Rumi",
    description: "Sign in to Rumi to start collaborating.",
    canonical: "/sign-in",
    noindex: true,
  });
  return (
    <div className="relative min-h-screen grid place-items-center p-6 bg-gradient-subtle overflow-hidden">
      <div className="absolute inset-0 grid-dots opacity-30 pointer-events-none" />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface/80 backdrop-blur-md p-8 shadow-lg animate-fade-in">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src={logoT} alt="Rumi" className="h-14 w-14 object-contain" />
          <h1 className="font-display text-2xl font-semibold tracking-tight text-balance">
            Welcome to Rumi
          </h1>
          <p className="text-sm text-muted-foreground">Sign in to start collaborating.</p>
          <div className="flex flex-col gap-2 w-full mt-2">
            <Button
              variant="outline"
              className="w-full h-10"
              onClick={() => signInWithProvider("github", next)}
            >
              <FaGithub className="h-4 w-4 mr-2" />
              Sign in with GitHub
            </Button>
            <Button
              variant="outline"
              className="w-full h-10"
              onClick={() => signInWithProvider("google", next)}
            >
              <FcGoogle className="h-4 w-4 mr-2" />
              Sign in with Google
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
