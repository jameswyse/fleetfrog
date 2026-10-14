import { createFileRoute } from "@tanstack/react-router";

import { CleanupSettings } from "@/features/settings/cleanup/CleanupSettings.tsx";

export const Route = createFileRoute("/_app/settings/cleanup")({ component: CleanupSettings });
