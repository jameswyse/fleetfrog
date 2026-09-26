import { createFileRoute } from "@tanstack/react-router";

import { HistoryPage } from "@/features/activity/HistoryPage.tsx";

export const Route = createFileRoute("/_app/activity/")({ component: HistoryPage });
