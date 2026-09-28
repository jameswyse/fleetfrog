import { createFileRoute } from "@tanstack/react-router";

import { SettingsLayout } from "@/features/settings/SettingsLayout.tsx";
import { AdminOnly } from "@/features/shell/AdminOnly.tsx";

export const Route = createFileRoute("/_app/settings")({
  component: () => (
    <AdminOnly>
      <SettingsLayout />
    </AdminOnly>
  ),
});
