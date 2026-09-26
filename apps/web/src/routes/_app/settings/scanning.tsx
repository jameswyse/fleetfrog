import { createFileRoute } from "@tanstack/react-router";

import { ScanningSettings } from "@/features/settings/scanning/ScanningSettings.tsx";

export const Route = createFileRoute("/_app/settings/scanning")({ component: ScanningSettings });
