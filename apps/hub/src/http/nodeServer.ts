import { NodeHttpServer } from "@effect/platform-node";
import { Duration, Effect, Layer } from "effect";

import type { Server } from "node:http";
import type { Socket } from "node:net";

/**
 * Serves on a Node server that stops promptly. Left to itself, Effect's server waits up to 20
 * seconds for connections to end before it interrupts the WebSockets keeping them open, which
 * outlasts Docker's 10-second stop timeout. Here WebSockets close as shutdown starts, and
 * connections still open after the grace period, such as a sleeping laptop's that never answers
 * the close, are cut.
 */
export function nodeServer(
  server: Server,
  options: {
    readonly port: number;
    readonly shutdownGrace?: Duration.Duration;
    /** The largest WebSocket message a client may send, so one can't take the hub's memory. */
    readonly maximumMessageBytes: number;
  },
) {
  // Node's own list of connections leaves out upgraded ones, which are the ones that linger.
  const connections = new Set<Socket>();

  server.on("connection", (socket: Socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });

  // Built after the server, so this starts the countdown before the server waits for its
  // connections to end. Detached, because the layer's own fibers stop as its scope closes.
  const cutOff = Layer.effectDiscard(
    Effect.addFinalizer(() =>
      Effect.sleep(options.shutdownGrace ?? Duration.seconds(3)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            for (const socket of connections) {
              socket.destroy();
            }
          }),
        ),
        Effect.forkDetach,
        Effect.asVoid,
      ),
    ),
  );

  return cutOff.pipe(
    Layer.provideMerge(
      NodeHttpServer.layer(() => server, {
        port: options.port,
        disablePreemptiveShutdown: true,
        websocket: { maxPayload: options.maximumMessageBytes },
      }),
    ),
  );
}
