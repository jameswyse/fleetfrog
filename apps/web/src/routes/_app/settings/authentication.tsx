import { createFileRoute } from "@tanstack/react-router";

import { AuthenticationSettings } from "@/features/settings/access/AuthenticationSettings.tsx";

export const Route = createFileRoute("/_app/settings/authentication")({
  component: AuthenticationSettings,
});
