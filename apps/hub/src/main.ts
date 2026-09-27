import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { ActionDispatcher } from "./actions/actionDispatcher.ts";
import { ActivityFeed } from "./activity/activityFeed.ts";
import { ActivityStore } from "./activity/activityStore.ts";
import { AgentServer } from "./agents/agentServer.ts";
import { AgentSessions } from "./agents/agentSessions.ts";
import { FolderRequests } from "./agents/folderRequests.ts";
import { CheckoutStore } from "./catalogue/checkoutStore.ts";
import { FleetFeed } from "./catalogue/fleetFeed.ts";
import { DashboardPresence } from "./dashboard/dashboardPresence.ts";
import { DashboardServer } from "./dashboard/dashboardServer.ts";
import { HubConfig } from "./hubConfig.ts";
import { MachineStore } from "./machines/machineStore.ts";
import { AgentCertificate } from "./pairing/agentCertificate.ts";
import { PairingOffers } from "./pairing/pairingOffers.ts";
import { Database } from "./persistence/database.ts";
import { ArchiveFolderStore } from "./settings/archiveFolderStore.ts";
import { PollingStore } from "./settings/pollingStore.ts";

const Hub = Layer.merge(AgentServer, DashboardServer).pipe(
  Layer.provide(ActionDispatcher.layer),
  Layer.provide(FolderRequests.layer),
  Layer.provideMerge(FleetFeed.layer),
  Layer.provideMerge(ActivityFeed.layer),
  Layer.provideMerge(AgentSessions.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      MachineStore.layer,
      CheckoutStore.layer,
      ActivityStore.layer,
      PollingStore.layer,
      ArchiveFolderStore.layer,
      DashboardPresence.layer,
    ),
  ),
  Layer.provideMerge(PairingOffers.layer),
  Layer.provideMerge(AgentCertificate.layer),
  Layer.provideMerge(Database),
  Layer.provideMerge(HubConfig.layer),
);

NodeRuntime.runMain(Layer.launch(Hub));
