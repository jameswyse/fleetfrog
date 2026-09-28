import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "@/features/account/AccountPage.tsx";

export const Route = createFileRoute("/_app/account")({ component: AccountPage });
