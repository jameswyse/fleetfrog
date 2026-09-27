import { createFileRoute } from "@tanstack/react-router";

import { IntegrationsSettings } from "@/features/settings/integrations/IntegrationsSettings.tsx";

export const Route = createFileRoute("/_app/settings/integrations/")({
  component: IntegrationsSettings,
});
