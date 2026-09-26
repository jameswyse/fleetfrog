import { createFileRoute } from "@tanstack/react-router";

import { RunningPage } from "@/features/activity/RunningPage.tsx";

export const Route = createFileRoute("/_app/activity/running")({ component: RunningPage });
