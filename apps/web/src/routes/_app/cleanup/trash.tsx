import { createFileRoute } from "@tanstack/react-router";

import { TrashPage } from "@/features/cleanup/TrashPage.tsx";

export const Route = createFileRoute("/_app/cleanup/trash")({ component: TrashPage });
