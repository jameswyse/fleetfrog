import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/features/shell/AppShell.tsx";

/** The overview and activity pages, under the main header. Settings has its own full-screen layout. */
export const Route = createFileRoute("/_app")({ component: AppShell });
