import { NodeHttpClient, NodeSocket } from "@effect/platform-node";
import { Data, Deferred, Effect, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { AgentRpcs } from "@fleetfrog/protocol/agent/rpcs";
import { PairingRpcs } from "@fleetfrog/protocol/pairing/rpcs";

import { pinnedTlsOptions } from "./hubTls.ts";

import type { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { AgentConfig } from "../config/agentConfig.ts";

/**
 * Builds the protocol in the caller's scope. `Effect.provide` would close the connection as soon as
 * the client was constructed.
 */
function clientInCallerScope<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  protocol: Layer.Layer<RpcClient.Protocol>,
) {
  return Layer.build(protocol).pipe(
    Effect.flatMap((context) => RpcClient.make(group).pipe(Effect.provideContext(context))),
  );
}

export class HubDisconnected extends Data.TaggedError("HubDisconnected")<{}> {}

/**
 * The agent's authenticated WebSocket client, plus an effect that fails when the socket drops.
 * The RPC protocol reconnects on its own but abandons open streams, so a session must end and
 * start again rather than wait on a stream the new connection knows nothing about.
 */
export const makeHubClient = Effect.fn("makeHubClient")(function* (config: AgentConfig) {
  const tls = pinnedTlsOptions(config.certificatePem);
  const dropped = yield* Deferred.make<void>();
  const webSocket = Layer.succeed(Socket.WebSocketConstructor)(
    (url) =>
      new NodeSocket.NodeWS.WebSocket(url, {
        headers: { authorization: `Bearer ${config.token}` },
        ...tls,
      }),
  );
  const hooks = Layer.succeed(RpcClient.ConnectionHooks)({
    onConnect: Effect.logInfo("Connected to hub"),
    onDisconnect: Deferred.succeed(dropped, undefined).pipe(Effect.asVoid),
  });
  const client = yield* clientInCallerScope(
    AgentRpcs,
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`${config.agentUrl}/agent`)),
      Layer.provide([webSocket, hooks, RpcSerialization.layerJson]),
    ),
  );

  return {
    client,
    disconnected: Deferred.await(dropped).pipe(Effect.andThen(Effect.fail(new HubDisconnected()))),
  };
});

/** A one-off HTTPS client for the unauthenticated pairing call. */
export function makePairingClient(options: {
  readonly agentUrl: URL;
  readonly certificatePem: string | null;
}) {
  const url = new URL("/pair", options.agentUrl);

  url.protocol = options.agentUrl.protocol === "ws:" ? "http:" : "https:";

  return clientInCallerScope(
    PairingRpcs,
    RpcClient.layerProtocolHttp({ url: url.href }).pipe(
      Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
      Layer.provide(NodeHttpClient.layerAgentOptions(pinnedTlsOptions(options.certificatePem))),
      Layer.provide(RpcSerialization.layerJson),
    ),
  );
}
