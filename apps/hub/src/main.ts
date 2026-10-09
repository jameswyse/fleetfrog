import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { ActionDispatcher } from "./actions/actionDispatcher.ts";
import { ActivityFeed } from "./activity/activityFeed.ts";
import { ActivityStore } from "./activity/activityStore.ts";
import { AgentServer } from "./agents/agentServer.ts";
import { AgentSessions } from "./agents/agentSessions.ts";
import { AgentUpdates } from "./agents/agentUpdates.ts";
import { FolderRequests } from "./agents/folderRequests.ts";
import { InspectionRequests } from "./agents/inspectionRequests.ts";
import { AuthSettingsStore } from "./auth/authSettingsStore.ts";
import { DashboardSessions } from "./auth/dashboardSessions.ts";
import { LoginThrottle } from "./auth/loginThrottle.ts";
import { OidcSignIn } from "./auth/oidcSignIn.ts";
import { ProviderIconStore } from "./auth/providerIcon.ts";
import { UserStore } from "./auth/userStore.ts";
import { CheckoutStore } from "./catalogue/checkoutStore.ts";
import { FleetFeed } from "./catalogue/fleetFeed.ts";
import { ProjectIconStore } from "./catalogue/projectIconStore.ts";
import { DashboardPresence } from "./dashboard/dashboardPresence.ts";
import { DashboardServer } from "./dashboard/dashboardServer.ts";
import { DemoFleet } from "./demo/demoFleet.ts";
import { HubConfig } from "./hubConfig.ts";
import { MachineStore } from "./machines/machineStore.ts";
import { AgentCertificate } from "./pairing/agentCertificate.ts";
import { PairingOffers } from "./pairing/pairingOffers.ts";
import { Database } from "./persistence/database.ts";
import { IntegrationsStore } from "./settings/integrationsStore.ts";
import { PollingStore } from "./settings/pollingStore.ts";
import { PreferencesStore } from "./settings/preferencesStore.ts";
import { ProjectLayoutStore } from "./settings/projectLayoutStore.ts";

type AgentSource = typeof AgentServer | typeof DemoFleet;

const Agents = Layer.unwrap(
  Effect.gen(function* () {
    const { demo } = yield* HubConfig;

    const agents: Layer.Layer<never, Layer.Error<AgentSource>, Layer.Services<AgentSource>> = demo
      ? DemoFleet
      : AgentServer;

    return agents;
  }),
);

const Hub = Layer.merge(Agents, DashboardServer).pipe(
  Layer.provide(ActionDispatcher.layer),
  Layer.provide(FolderRequests.layer),
  Layer.provide(InspectionRequests.layer),
  Layer.provideMerge(FleetFeed.layer),
  Layer.provideMerge(ActivityFeed.layer),
  Layer.provideMerge(AgentUpdates.layer),
  Layer.provideMerge(AgentSessions.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      MachineStore.layer,
      CheckoutStore.layer,
      ActivityStore.layer,
      PollingStore.layer,
      IntegrationsStore.layer,
      PreferencesStore.layer,
      ProjectLayoutStore.layer,
      ProjectIconStore.layer,
      DashboardPresence.layer,
      LoginThrottle.layer,
    ),
  ),
  Layer.provideMerge(OidcSignIn.layer),
  Layer.provideMerge(ProviderIconStore.layer),
  Layer.provideMerge(DashboardSessions.layer),
  Layer.provideMerge(UserStore.layer),
  Layer.provideMerge(AuthSettingsStore.layer),
  Layer.provideMerge(PairingOffers.layer),
  Layer.provideMerge(AgentCertificate.layer),
  Layer.provideMerge(Database),
  Layer.provideMerge(HubConfig.layer),
);

NodeRuntime.runMain(Layer.launch(Hub));
