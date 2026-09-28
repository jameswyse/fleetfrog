import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/features/shell/AppShell.tsx";
import { isSignedOut, settledSession } from "@/rpc/session.ts";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    if (isSignedOut(await settledSession())) {
      throw redirect({ to: "/login", search: { redirect: location.href }, replace: true });
    }
  },
  component: AppShell,
});
