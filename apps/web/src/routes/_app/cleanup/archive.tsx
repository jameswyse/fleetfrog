import { createFileRoute } from "@tanstack/react-router";

import { ArchivePage } from "@/features/cleanup/ArchivePage.tsx";

export const Route = createFileRoute("/_app/cleanup/archive")({ component: ArchivePage });
