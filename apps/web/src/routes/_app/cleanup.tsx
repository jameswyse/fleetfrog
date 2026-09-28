import { createFileRoute } from "@tanstack/react-router";

import { CleanupLayout } from "@/features/cleanup/CleanupLayout.tsx";
import { AdminOnly } from "@/features/shell/AdminOnly.tsx";

export const Route = createFileRoute("/_app/cleanup")({
  component: () => (
    <AdminOnly>
      <CleanupLayout />
    </AdminOnly>
  ),
});
