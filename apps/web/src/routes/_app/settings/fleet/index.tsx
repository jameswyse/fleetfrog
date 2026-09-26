import { createFileRoute } from "@tanstack/react-router";

import { FleetSettings } from "@/features/settings/fleet/FleetSettings.tsx";

export const Route = createFileRoute("/_app/settings/fleet/")({ component: FleetSettings });
