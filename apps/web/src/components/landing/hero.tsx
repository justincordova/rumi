import { Link } from "@tanstack/react-router";
import { ArrowDown, Code2, Eye, Paintbrush, Zap } from "lucide-react";
import { WordSwap } from "./word-swap";

const BADGES = [
  {
    icon: Zap,
    label: "Real-time sync",
    color: "bg-[#8839ef]/10 text-[#8839ef] dark:bg-[#cba6f7]/15 dark:text-[#cba6f7]",
  },
  {
    icon: Code2,
    label: "Markdown + code",
    color: "bg-[#1e66f5]/10 text-[#1e66f5] dark:bg-[#89b4fa]/15 dark:text-[#89b4fa]",
  },
  {
    icon: Paintbrush,
    label: "Drawing boards",
    color: "bg-[#ea76cb]/10 text-[#d63384] dark:bg-[#f5c2e7]/15 dark:text-[#f5c2e7]",
  },
  {
    icon: Eye,
    label: "Guest access",
    color: "bg-[#40a02b]/10 text-[#40a02b] dark:bg-[#a6e3a1]/15 dark:text-[#a6e3a1]",
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
            words={["technical", "research", "team"]}
            className="bg-gradient-to-r from-[#8839ef] via-[#ea76cb] to-[#8839ef] bg-clip-text text-transparent dark:from-[#cba6f7] dark:via-[#f5c2e7] dark:to-[#cba6f7]"
          />{" "}
          docs
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-balance">
          Markdown, code, and drawings in shared rooms. No setup, no merge conflicts.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <Link to="/sign-in" search={{ next: "/dashboard" }}>
            <button
              type="button"
              className="inline-flex items-center justify-center h-11 rounded-lg px-8 text-[15px] font-semibold text-white transition-all duration-200 hover:brightness-110 hover:shadow-[0_0_24px_rgba(136,57,239,0.35)] bg-gradient-to-r from-[#8839ef] via-[#ea76cb] to-[#8839ef] dark:from-[#cba6f7] dark:via-[#f5c2e7] dark:to-[#cba6f7] dark:text-[#11111b]"
            >
              Start for free
            </button>
          </Link>
          <button
            type="button"
            className="inline-flex items-center justify-center h-11 rounded-lg px-8 text-[15px] font-medium text-muted-foreground transition-colors hover:text-foreground"
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
        <p className="mt-2 text-[13px] text-muted-foreground/60">No credit card required</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {BADGES.map((b) => (
            <span
              key={b.label}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${b.color}`}
            >
              <b.icon className="h-3.5 w-3.5" />
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
