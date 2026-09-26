import { createRootRoute } from "@tanstack/react-router";

import { AppShell } from "@/features/shell/AppShell.tsx";

export const Route = createRootRoute({ component: AppShell });
