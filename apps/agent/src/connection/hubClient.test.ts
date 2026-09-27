import { createServer } from "node:net";

import { describe, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { makeHubClient } from "./hubClient.ts";

import type { Server, Socket } from "node:net";

/**
 * A TCP server that accepts connections but never answers the WebSocket handshake, so the agent's
 * socket stays connecting. `accepted` completes when the first connection arrives.
 */
const silentServer = (accepted: Deferred.Deferred<void>) =>
  Effect.acquireRelease(
    Effect.callback<{ readonly server: Server; readonly sockets: Set<Socket> }>((resume) => {
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        sockets.add(socket);
        Deferred.doneUnsafe(accepted, Effect.void);
      });

      server.listen(0, "127.0.0.1", () => resume(Effect.succeed({ server, sockets })));
    }),
    ({ server, sockets }) =>
      Effect.sync(() => {
        for (const socket of sockets) {
          socket.destroy();
        }

        server.close();
      }),
  ).pipe(
    Effect.flatMap(({ server }) => {
      const address = server.address();

      // A TCP server reports an address object; a string would mean a pipe or socket path.
      return address instanceof Object
        ? Effect.succeed(address.port)
        : Effect.die(new Error("The test server is not listening on a TCP port."));
    }),
  );

describe("hub client", () => {
  // The agent ends its session while the RPC protocol may be mid-reconnect. Closing a `ws` socket
  // that is still connecting emits "error" on the next tick, and an unhandled one exits Node.
  it.live("closes a connection that is still opening without an unhandled error", () =>
    Effect.gen(function* () {
      const accepted = yield* Deferred.make<void>();
      const port = yield* silentServer(accepted);

      yield* Effect.scoped(
        makeHubClient({
          agentUrl: `ws://127.0.0.1:${port}`,
          machineId: MachineId.make("00000000-0000-4000-8000-000000000001"),
          token: "test-token",
          certificatePem: null,
        }).pipe(Effect.andThen(Deferred.await(accepted))),
      );
      // Let the error the aborted handshake schedules fire before the test ends.
      yield* Effect.sleep("50 millis");
    }),
  );
});
