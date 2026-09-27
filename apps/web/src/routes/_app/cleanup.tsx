import { createFileRoute } from "@tanstack/react-router";

import { CleanupLayout } from "@/features/cleanup/CleanupLayout.tsx";

export const Route = createFileRoute("/_app/cleanup")({ component: CleanupLayout });
