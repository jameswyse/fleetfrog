import { NodeHttpClient, NodeSocket } from "@effect/platform-node";
import { Deferred, Effect, Layer, Schema } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

import { AgentRpcs } from "@fleetfrog/protocol/agent/rpcs";
import { PairingRpcs } from "@fleetfrog/protocol/pairing/rpcs";

import { pinnedTlsOptions } from "./hubTls.ts";

import type { Rpc, RpcGroup } from "effect/rpc";

import type { AgentConfig } from "../config/agentConfig.ts";

export function hubEndpoint(agentUrl: URL, endpoint: "agent" | "pair"): URL {
  const base = new URL(agentUrl);

  if (!base.pathname.endsWith("/")) {
    base.pathname = `${base.pathname}/`;
  }

  const url = new URL(endpoint, base);

  if (endpoint === "pair") {
    url.protocol = agentUrl.protocol === "ws:" ? "http:" : "https:";
  }

  return url;
}

function clientInCallerScope<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  protocol: Layer.Layer<RpcClient.Protocol>,
) {
  return Layer.build(protocol).pipe(
    Effect.flatMap((context) => RpcClient.make(group).pipe(Effect.provideContext(context))),
  );
}

export class HubDisconnected extends Schema.TaggedError<HubDisconnected>()("HubDisconnected", {}) {}

export const makeHubClient = Effect.fn("makeHubClient")(function* (config: AgentConfig) {
  const tls = pinnedTlsOptions(config.certificatePem);
  const dropped = yield* Deferred.make<void>();

  const webSocket = Layer.succeed(Socket.WebSocketConstructor)((url) => {
    const socket = new NodeSocket.NodeWS.WebSocket(url, {
      headers: { authorization: `Bearer ${config.token}` },
      ...tls,
    });

    socket.on("error", () => undefined);

    return socket;
  });

  const hooks = Layer.succeed(RpcClient.ConnectionHooks)({
    onConnect: Effect.logInfo("Connected to hub"),
    onDisconnect: Deferred.succeed(dropped, undefined).pipe(Effect.asVoid),
  });

  const client = yield* clientInCallerScope(
    AgentRpcs,
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(hubEndpoint(new URL(config.agentUrl), "agent").href)),
      Layer.provide([webSocket, hooks, RpcSerialization.layerJson]),
    ),
  );

  return {
    client,
    disconnected: Deferred.await(dropped).pipe(Effect.andThen(Effect.fail(new HubDisconnected()))),
  };
});

export function makePairingClient(options: {
  readonly agentUrl: URL;
  readonly certificatePem: string | null;
}) {
  const url = hubEndpoint(options.agentUrl, "pair");

  return clientInCallerScope(
    PairingRpcs,
    RpcClient.layerProtocolHttp({ url: url.href }).pipe(
      Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
      Layer.provide(NodeHttpClient.layerAgentOptions(pinnedTlsOptions(options.certificatePem))),
      Layer.provide(RpcSerialization.layerJson),
    ),
  );
}
