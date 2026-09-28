import { createFileRoute } from "@tanstack/react-router";

import { UsersSettings } from "@/features/settings/access/UsersSettings.tsx";

export const Route = createFileRoute("/_app/settings/users")({ component: UsersSettings });
