import { Layer } from "effect";

import { ActionDispatcher } from "./actions/actionDispatcher.ts";
import { ActivityFeed } from "./activity/activityFeed.ts";
import { ActivityStore } from "./activity/activityStore.ts";
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
import { demoT3CodeReleases } from "./demo/demoWorld.ts";
import { HubConfig } from "./hubConfig.ts";
import { MachineStore } from "./machines/machineStore.ts";
import { AgentCertificate } from "./pairing/agentCertificate.ts";
import { PairingOffers } from "./pairing/pairingOffers.ts";
import { Database } from "./persistence/database.ts";
import { CleanupStore } from "./settings/cleanupStore.ts";
import { IntegrationsStore } from "./settings/integrationsStore.ts";
import { PollingStore } from "./settings/pollingStore.ts";
import { PreferencesStore } from "./settings/preferencesStore.ts";
import { ProjectLayoutStore } from "./settings/projectLayoutStore.ts";
import { T3CodeReleaseFeed } from "./t3Code/t3CodeReleaseFeed.ts";
import { T3CodeUpdates } from "./t3Code/t3CodeUpdates.ts";

const Stores = Layer.mergeAll(
  MachineStore.layer,
  CheckoutStore.layer,
  ActivityStore.layer,
  PollingStore.layer,
  CleanupStore.layer,
  IntegrationsStore.layer,
  PreferencesStore.layer,
  ProjectLayoutStore.layer,
  ProjectIconStore.layer,
  ProviderIconStore.layer,
  DashboardPresence.layer,
  LoginThrottle.layer,
);

const Auth = Layer.merge(OidcSignIn.layer, DashboardSessions.layer).pipe(
  Layer.provideMerge(UserStore.layer),
  Layer.provideMerge(AuthSettingsStore.layer),
);

const Pairing = PairingOffers.layer.pipe(Layer.provideMerge(AgentCertificate.layer));

const T3CodeReleases = Layer.unwrap(
  HubConfig.useSync(({ demo }) =>
    demo ? T3CodeReleaseFeed.fixed(demoT3CodeReleases) : T3CodeReleaseFeed.layer,
  ),
);

const Fleet = Layer.merge(FleetFeed.layer, ActivityFeed.layer).pipe(
  Layer.provideMerge(Layer.merge(AgentUpdates.layer, T3CodeUpdates.layer)),
  Layer.provideMerge(Layer.merge(AgentSessions.layer, T3CodeReleases)),
);

const Requests = Layer.mergeAll(
  ActionDispatcher.layer,
  FolderRequests.layer,
  InspectionRequests.layer,
);

export const HubServices = Requests.pipe(
  Layer.provideMerge(Fleet),
  Layer.provideMerge(Layer.mergeAll(Stores, Auth, Pairing)),
  Layer.provideMerge(Database),
);
