import { createFileRoute } from "@tanstack/react-router";

import { MachineSettings } from "@/features/settings/fleet/MachineSettings.tsx";

export const Route = createFileRoute("/_app/settings/fleet/$machineId")({
  component: MachineSettings,
});
