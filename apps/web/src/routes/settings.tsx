import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/features/settings/SettingsPage.tsx";

export const Route = createFileRoute("/settings")({ component: SettingsPage });
