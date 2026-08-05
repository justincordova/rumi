import { Link } from "@tanstack/react-router";
import { ArrowDown, Code2, Eye, Paintbrush, Zap } from "lucide-react";
import { WordSwap } from "./word-swap";

// The Latte accents are too light to carry 13px label text on their own 10%
// tint — measured 2.53:1 (green) to 3.88:1 (mauve) against the 4.5:1 AA floor,
// and no darker variant of those hues exists in the ramp. So in light mode the
// label falls back to the foreground token and the accent is carried by the
// icon and the tint. Mocha already clears AA (5.25:1–7.20:1), so dark mode
// keeps the coloured label.
const BADGES = [
  {
    icon: Zap,
    label: "Real-time sync",
    tint: "bg-[#8839ef]/10 dark:bg-[#cba6f7]/15",
    text: "text-foreground dark:text-[#cba6f7]",
    iconColor: "text-[#8839ef] dark:text-[#cba6f7]",
  },
  {
    icon: Code2,
    label: "Markdown + code",
    tint: "bg-[#1e66f5]/10 dark:bg-[#89b4fa]/15",
    text: "text-foreground dark:text-[#89b4fa]",
    iconColor: "text-[#1e66f5] dark:text-[#89b4fa]",
  },
  {
    icon: Paintbrush,
    label: "Drawing boards",
    tint: "bg-[#ea76cb]/10 dark:bg-[#f5c2e7]/15",
    text: "text-foreground dark:text-[#f5c2e7]",
    iconColor: "text-[#d63384] dark:text-[#f5c2e7]",
  },
  {
    icon: Eye,
    label: "Guest access",
    tint: "bg-[#40a02b]/10 dark:bg-[#a6e3a1]/15",
    text: "text-foreground dark:text-[#a6e3a1]",
    iconColor: "text-[#40a02b] dark:text-[#a6e3a1]",
  },
];

export function Hero() {
  return (
    <section
      id="hero"
      className="relative mx-auto max-w-6xl px-6 pt-24 pb-8 text-center md:pt-32 md:pb-10"
    >
      <div className="relative animate-fade-in">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl text-balance">
          Real-time collaboration
          <br />
          for{" "}
          <WordSwap
            words={["project", "research", "team"]}
            className="bg-gradient-to-r from-[#8839ef] via-[#ea76cb] to-[#8839ef] bg-clip-text text-transparent dark:from-[#cba6f7] dark:via-[#f5c2e7] dark:to-[#cba6f7]"
          />{" "}
          docs
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-balance">
          Markdown, code, and drawings in shared rooms. No setup, no merge conflicts.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <Link
            to="/sign-in"
            search={{ next: "/dashboard" }}
            className="inline-flex items-center justify-center h-11 rounded-lg px-8 text-[15px] font-semibold text-white transition-all duration-200 hover:brightness-110 hover:shadow-[0_0_24px_rgba(136,57,239,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-gradient-to-r from-[#8839ef] via-[#ea76cb] to-[#8839ef] dark:from-[#cba6f7] dark:via-[#f5c2e7] dark:to-[#cba6f7] dark:text-[#11111b]"
          >
            Start for free
          </Link>
          <button
            type="button"
            className="inline-flex items-center justify-center h-11 rounded-lg px-8 text-[15px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={() =>
              document
                .getElementById("sandbox")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Try it
            <ArrowDown className="h-4 w-4 ml-1.5 animate-bounce" />
          </button>
        </div>
        {/* Was text-muted-foreground/60, which measured 2.42:1 (light) and
            2.81:1 (dark) — the 60% alpha put it well under AA. */}
        <p className="mt-2 text-[13px] text-muted-foreground">No credit card required</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {BADGES.map((b) => (
            <span
              key={b.label}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${b.tint} ${b.text}`}
            >
              <b.icon className={`h-3.5 w-3.5 ${b.iconColor}`} aria-hidden="true" />
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
