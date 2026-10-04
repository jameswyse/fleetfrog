import { Effect, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

import { DashboardRpcs } from "../../packages/protocol/src/dashboard/rpcs.ts";

import type { RpcClientError } from "effect/rpc";

type DashboardClient = RpcClient.FromGroup<typeof DashboardRpcs, RpcClientError.RpcClientError>;

export function dashboardUrl(): string {
  const url = process.env.FLEETFROG_E2E_URL;

  if (url === undefined) {
    throw new Error("The e2e dashboard URL is missing.");
  }

  return url;
}

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
