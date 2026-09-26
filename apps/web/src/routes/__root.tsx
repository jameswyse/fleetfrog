import { createRootRoute, Outlet } from "@tanstack/react-router";
import { LucideProvider } from "lucide-react";

/** Icons default to the size of body text and never shrink in a row. */
function Root() {
  return (
    <LucideProvider size={16} className="shrink-0">
      <Outlet />
    </LucideProvider>
  );
}

export const Route = createRootRoute({ component: Root });
