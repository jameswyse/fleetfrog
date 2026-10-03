import { Effect, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

import { DashboardRpcs } from "../../packages/protocol/src/dashboard/rpcs.ts";

import type { RpcClientError } from "effect/rpc";

type DashboardClient = RpcClient.FromGroup<typeof DashboardRpcs, RpcClientError.RpcClientError>;

/** Uses the same typed WebSocket RPCs as the dashboard, with no test routes on the hub. */
export function withDashboard<A, E>(
  url: string,
  use: (client: DashboardClient) => Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  const socketUrl = new URL("/rpc", url);

  socketUrl.protocol = "ws:";

  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(Socket.layerWebSocket(socketUrl.href)),
    Layer.provide([Socket.layerWebSocketConstructorGlobal, RpcSerialization.layerJson]),
  );

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(protocol);
        const client = yield* RpcClient.make(DashboardRpcs).pipe(Effect.provideContext(context));

        return yield* use(client);
      }).pipe(Effect.timeout("30 seconds")),
    ),
    { signal },
  );
}
