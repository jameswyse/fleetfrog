import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/features/shell/AppShell.tsx";

export const Route = createFileRoute("/_app")({ component: AppShell });
