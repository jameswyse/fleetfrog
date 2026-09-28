import { describe, expect, it } from "@effect/vitest";

import { agentUrlFromServeConfig } from "./tailscaleServe.ts";

describe("agentUrlFromServeConfig", () => {
  it("picks the HTTPS port that forwards to the agent port", () => {
    const config = {
      Web: {
        "fleetfrog.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:7420" } } },
        "fleetfrog.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:7421" } } },
      },
    };

    expect(agentUrlFromServeConfig(config, 7421)).toBe("wss://fleetfrog.tail1234.ts.net:8443");
  });

  it("leaves out port 443", () => {
    const config = {
      Web: {
        "hub.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://localhost:7421" } } },
      },
    };

    expect(agentUrlFromServeConfig(config, 7421)).toBe("wss://hub.tail1234.ts.net");
  });

  it("finds nothing when Serve forwards only other servers", () => {
    const config = {
      Web: {
        "epicdev.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } } },
      },
    };

    expect(agentUrlFromServeConfig(config, 7421)).toBeNull();
    expect(agentUrlFromServeConfig({}, 7421)).toBeNull();
  });
});
