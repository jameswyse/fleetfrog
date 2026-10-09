import { Config, Context, Layer, Schema } from "effect";

const WebSocketUrl = Schema.String.check(
  Schema.makeFilter(
    (url) =>
      (URL.canParse(url) && ["ws:", "wss:"].includes(new URL(url).protocol)) ||
      "must be a ws:// or wss:// URL",
  ),
);

export const AgentTransport = Config.Literals(["self-signed", "none"], "FLEETFROG_AGENT_TLS");

export class HubConfig extends Context.Service<
  HubConfig,
  {
    readonly dataDirectory: string;
    readonly host: string | null;
    readonly dashboardPort: number;
    readonly agentPort: number;
    readonly agentTls: "self-signed" | "none";
    readonly agentUrl: string | null;
    readonly tailscaleSocket: string | null;
    readonly dashboardSocket: string | null;
    readonly webRoot: string | null;
    readonly authModeOverride: "none" | null;
    readonly demo: boolean;
  }
>()("fleetfrog/HubConfig") {
  static readonly layer = Layer.effect(this)(
    Config.all({
      dataDirectory: Config.String("FLEETFROG_DATA_DIR").pipe(Config.withDefault("data")),
      host: Config.NonEmptyString("FLEETFROG_HOST").pipe(Config.withDefault(null)),
      dashboardPort: Config.Port("FLEETFROG_DASHBOARD_PORT").pipe(Config.withDefault(7420)),
      agentPort: Config.Port("FLEETFROG_AGENT_PORT").pipe(Config.withDefault(7421)),
      agentTls: AgentTransport.pipe(Config.withDefault("self-signed" as const)),
      agentUrl: Config.schema(WebSocketUrl, "FLEETFROG_AGENT_URL").pipe(Config.withDefault(null)),
      tailscaleSocket: Config.NonEmptyString("FLEETFROG_TAILSCALE_SOCKET").pipe(
        Config.withDefault(null),
      ),
      dashboardSocket: Config.NonEmptyString("FLEETFROG_DASHBOARD_SOCKET").pipe(
        Config.withDefault(null),
      ),
      webRoot: Config.NonEmptyString("FLEETFROG_WEB_ROOT").pipe(Config.withDefault(null)),
      authModeOverride: Config.Literals(["none"], "FLEETFROG_AUTH_MODE").pipe(
        Config.withDefault(null),
      ),
      demo: Config.Boolean("FLEETFROG_DEMO").pipe(Config.withDefault(false)),
    }),
  );
}
