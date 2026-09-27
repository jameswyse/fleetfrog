import { createFileRoute } from "@tanstack/react-router";

import { T3CodeSettings } from "@/features/settings/integrations/T3CodeSettings.tsx";

export const Route = createFileRoute("/_app/settings/integrations/t3-code")({
  component: T3CodeSettings,
});
