import { NodeHttpClient } from "@effect/platform-node";
import { Agent } from "@effect/platform-node/Undici";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { TailscaleServeUnavailable } from "@fleetfrog/protocol/dashboard/rpcs";

const ServeConfig = Schema.Struct({
  Web: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        Handlers: Schema.optional(
          Schema.Record(Schema.String, Schema.Struct({ Proxy: Schema.optional(Schema.String) })),
        ),
      }),
    ),
  ),
});
type ServeConfig = typeof ServeConfig.Type;

const loopbackHosts = new Set(["127.0.0.1", "localhost"]);

function proxiesTo(target: string, port: number): boolean {
  if (!URL.canParse(target)) {
    return false;
  }

  const url = new URL(target);

  return url.protocol === "http:" && loopbackHosts.has(url.hostname) && Number(url.port) === port;
}

export function agentUrlFromServeConfig(config: ServeConfig, agentPort: number): string | null {
  for (const [hostAndPort, site] of Object.entries(config.Web ?? {})) {
    const target = site.Handlers?.["/"]?.Proxy;

    if (target !== undefined && proxiesTo(target, agentPort)) {
      return new URL(`wss://${hostAndPort}`).origin;
    }
  }

  return null;
}

export const readTailnetAgentUrl = Effect.fn("readTailnetAgentUrl")(function* (
  socketPath: string,
  agentPort: number,
): Effect.fn.Return<string, TailscaleServeUnavailable> {
  const localApi = NodeHttpClient.layerUndiciNoDispatcher.pipe(
    Layer.provide(
      Layer.effect(NodeHttpClient.Dispatcher)(
        Effect.acquireRelease(
          Effect.sync(() => new Agent({ connect: { socketPath } })),
          (dispatcher) => Effect.promise(() => dispatcher.destroy()),
        ),
      ),
    ),
  );

  const serveConfig = yield* HttpClient.get(
    "http://local-tailscaled.sock/localapi/v0/serve-config",
  ).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(ServeConfig)),
    Effect.timeout("5 seconds"),
    Effect.provide(localApi),
    Effect.tapCause((cause) =>
      Effect.logWarning("Couldn't read Tailscale Serve's settings", cause),
    ),
    Effect.mapError(
      () =>
        new TailscaleServeUnavailable({
          message: `Couldn't read Tailscale Serve's settings through ${socketPath}. Check that Tailscale is running and signed in.`,
        }),
    ),
  );

  const url = agentUrlFromServeConfig(serveConfig, agentPort);

  if (url === null) {
    return yield* new TailscaleServeUnavailable({
      message: `Tailscale Serve doesn't forward an HTTPS port to the hub's agent port, ${agentPort}.`,
    });
  }

  return url;
});
