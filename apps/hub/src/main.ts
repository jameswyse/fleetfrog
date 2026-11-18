import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { AgentServer } from "./agents/agentServer.ts";
import { DashboardServer } from "./dashboard/dashboardServer.ts";
import { DemoFleet } from "./demo/demoFleet.ts";
import { HubConfig } from "./hubConfig.ts";
import { HubServices } from "./hubServices.ts";

type AgentSource = typeof AgentServer | typeof DemoFleet;

const Agents = Layer.unwrap(
  HubConfig.useSync(({ demo }) => {
    const agents: Layer.Layer<never, Layer.Error<AgentSource>, Layer.Services<AgentSource>> = demo
      ? DemoFleet
      : AgentServer;

    return agents;
  }),
);

const Hub = Layer.merge(Agents, DashboardServer).pipe(
  Layer.provide(HubServices),
  Layer.provide(HubConfig.layer),
);

NodeRuntime.runMain(Layer.launch(Hub));
