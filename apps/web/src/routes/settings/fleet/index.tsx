import { createFileRoute } from "@tanstack/react-router";

import { FleetSettings } from "@/features/settings/fleet/FleetSettings.tsx";

export const Route = createFileRoute("/settings/fleet/")({ component: FleetSettings });
