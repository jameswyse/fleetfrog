import { Layer } from "effect";

import { HubConfig } from "./hubConfig.ts";

export function testHubConfig(overrides: Partial<HubConfig["Service"]> = {}) {
  return Layer.succeed(HubConfig)({
    dataDirectory: "unused",
    host: null,
    dashboardPort: 7420,
    agentPort: 7421,
    agentTls: "self-signed",
    agentUrl: null,
    tailscaleSocket: null,
    dashboardSocket: null,
    webRoot: null,
    authModeOverride: null,
    demo: false,
    ...overrides,
  });
}
