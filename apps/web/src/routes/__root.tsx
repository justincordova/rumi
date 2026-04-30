import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useTheme } from "next-themes";

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider>
      <TooltipProvider delayDuration={150}>
        <Outlet />
        <ThemedToaster />
      </TooltipProvider>
    </ThemeProvider>
  ),
});

// Sonner toaster bound to next-themes + design tokens
function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme as "light" | "dark" | "system"}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "group bg-background text-foreground border-border shadow-lg",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
        },
      }}
    />
  );
}
