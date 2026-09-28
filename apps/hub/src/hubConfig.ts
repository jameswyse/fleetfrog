import { Config, Context, Layer, Schema } from "effect";

/** An agent endpoint such as `wss://fleetfrog.example.com`. */
const WebSocketUrl = Schema.String.check(
  Schema.makeFilter(
    (url) =>
      (URL.canParse(url) && ["ws:", "wss:"].includes(new URL(url).protocol)) ||
      "must be a ws:// or wss:// URL",
  ),
);

export const AgentTransport = Config.Literals(["self-signed", "none"], "FLEETFROG_AGENT_TLS");

/** Hub settings read from the environment at start-up. */
export class HubConfig extends Context.Service<
  HubConfig,
  {
    readonly dataDirectory: string;
    readonly dashboardPort: number;
    readonly agentPort: number;
    /** `none` serves agents over plain WebSocket for a reverse proxy that terminates TLS. */
    readonly agentTls: "self-signed" | "none";
    /** The public agent URL, when agents cannot reach the hub on the dashboard's host. */
    readonly agentUrl: string | null;
    /** tailscaled's local API socket, shared from a sidecar whose Tailscale Serve fronts the hub. */
    readonly tailscaleSocket: string | null;
    /** Built dashboard files. Absent in development, where Vite serves the dashboard. */
    readonly webRoot: string | null;
    /** `none` turns sign-in off whatever the settings say, for an admin who can't sign in. */
    readonly authModeOverride: "none" | null;
  }
>()("fleetfrog/HubConfig") {
  static readonly layer = Layer.effect(this)(
    Config.all({
      dataDirectory: Config.String("FLEETFROG_DATA_DIR").pipe(Config.withDefault("data")),
      dashboardPort: Config.Port("FLEETFROG_DASHBOARD_PORT").pipe(Config.withDefault(7420)),
      agentPort: Config.Port("FLEETFROG_AGENT_PORT").pipe(Config.withDefault(7421)),
      agentTls: AgentTransport.pipe(Config.withDefault("self-signed" as const)),
      agentUrl: Config.schema(WebSocketUrl, "FLEETFROG_AGENT_URL").pipe(Config.withDefault(null)),
      tailscaleSocket: Config.NonEmptyString("FLEETFROG_TAILSCALE_SOCKET").pipe(
        Config.withDefault(null),
      ),
      webRoot: Config.NonEmptyString("FLEETFROG_WEB_ROOT").pipe(Config.withDefault(null)),
      authModeOverride: Config.Literals(["none"], "FLEETFROG_AUTH_MODE").pipe(
        Config.withDefault(null),
      ),
    }),
  );
}
