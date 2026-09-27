import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/cleanup/")({
  beforeLoad: () => {
    throw redirect({ to: "/cleanup/archive", replace: true });
  },
});
