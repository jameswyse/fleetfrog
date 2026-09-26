import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { AgentServer } from "./agents/agentServer.ts";
import { AgentSessions } from "./agents/agentSessions.ts";
import { CheckoutStore } from "./catalogue/checkoutStore.ts";
import { FleetFeed } from "./catalogue/fleetFeed.ts";
import { DashboardPresence } from "./dashboard/dashboardPresence.ts";
import { DashboardServer } from "./dashboard/dashboardServer.ts";
import { HubConfig } from "./hubConfig.ts";
import { MachineStore } from "./machines/machineStore.ts";
import { AgentCertificate } from "./pairing/agentCertificate.ts";
import { PairingOffers } from "./pairing/pairingOffers.ts";
import { Database } from "./persistence/database.ts";
import { PollingStore } from "./settings/pollingStore.ts";

const Hub = Layer.merge(AgentServer, DashboardServer).pipe(
  Layer.provide(FleetFeed.layer),
  Layer.provideMerge(AgentSessions.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      MachineStore.layer,
      CheckoutStore.layer,
      PollingStore.layer,
      DashboardPresence.layer,
    ),
  ),
  Layer.provideMerge(PairingOffers.layer),
  Layer.provideMerge(AgentCertificate.layer),
  Layer.provideMerge(Database),
  Layer.provideMerge(HubConfig.layer),
);

NodeRuntime.runMain(Layer.launch(Hub));
