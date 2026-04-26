import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen flex items-center justify-center text-2xl font-medium">
      <Outlet />
    </div>
  ),
});
