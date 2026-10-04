import { NodeHttpServer } from "@effect/platform-node";
import { Duration, Effect, Layer } from "effect";

import type { Server } from "node:http";
import type { Socket } from "node:net";

export function nodeServer(
  server: Server,
  options: {
    readonly port: number;
    readonly host?: string | undefined;
    readonly shutdownGrace?: Duration.Duration;
    readonly maximumMessageBytes: number;
  },
) {
  const connections = new Set<Socket>();

  server.on("connection", (socket: Socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });

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
        host: options.host,
        disablePreemptiveShutdown: true,
        websocket: { maxPayload: options.maximumMessageBytes },
      }),
    ),
  );
}
