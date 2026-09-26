import { createFileRoute } from "@tanstack/react-router";

import { PairMachine } from "@/features/settings/fleet/PairMachine.tsx";

export const Route = createFileRoute("/_app/settings/fleet/pair")({ component: PairMachine });
