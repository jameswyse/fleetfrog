import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settings opens on its first section. */
export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/scanning", replace: true });
  },
});
