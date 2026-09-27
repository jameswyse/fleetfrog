import { createFileRoute } from "@tanstack/react-router";

import { ArchiveSettings } from "@/features/settings/archive/ArchiveSettings.tsx";

export const Route = createFileRoute("/_app/settings/archive")({ component: ArchiveSettings });
