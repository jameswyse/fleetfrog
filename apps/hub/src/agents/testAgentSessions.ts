import { Layer } from "effect";

import { DashboardPresence } from "../dashboard/dashboardPresence.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { TestDatabase } from "../persistence/testDatabase.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { AgentSessions } from "./agentSessions.ts";

export const TestAgentSessions = AgentSessions.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      MachineStore.layer,
      PollingStore.layer,
      IntegrationsStore.layer,
      DashboardPresence.layer,
    ),
  ),
  Layer.provideMerge(TestDatabase),
);
