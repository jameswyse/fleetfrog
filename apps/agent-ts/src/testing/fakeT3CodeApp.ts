import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import { NodeSocket } from "@effect/platform-node";
import { Effect } from "effect";

import type { Duplex } from "node:stream";

export const fakeSessionToken = "token-secret";

const ticket = "ticket-1";

export const supportedDescriptor = {
  serverVersion: "0.0.46",
  orchestrationProtocolVersion: 2,
  capabilities: {
    serverSelfUpdate: "desktop-managed",
    desktopAppUpdate: true,
    serverSelfUpdateProgress: true,
  },
};

export interface FakeAppSocket {
  readonly send: (message: unknown) => void;
  readonly close: () => void;
}

export function fakeT3CodeApp(options: {
  readonly descriptor?: unknown;
  readonly onPrepare: (socket: FakeAppSocket) => void;
  readonly onCommit?: ((socket: FakeAppSocket) => void) | undefined;
  readonly stallHandshake?: boolean;
}) {
  const received: Array<unknown> = [];
  const stalled: Array<Duplex> = [];

  return Effect.acquireRelease(
    Effect.callback<{ readonly server: ReturnType<typeof createServer>; readonly port: number }>(
      (resume) => {
        const server = createServer((request, response) => {
          if (request.url === "/.well-known/t3/environment") {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify(options.descriptor ?? supportedDescriptor));

            return;
          }

          if (
            request.method === "POST" &&
            request.url === "/api/auth/websocket-ticket" &&
            request.headers.authorization === `Bearer ${fakeSessionToken}`
          ) {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ticket, expiresAt: "2026-10-13T00:05:00.000Z" }));

            return;
          }

          response.statusCode = 401;
          response.end();
        });

        if (options.stallHandshake === true) {
          server.on("upgrade", (_request, socket) => stalled.push(socket));
        }

        const sockets = new NodeSocket.NodeWS.WebSocketServer(
          options.stallHandshake === true ? { noServer: true } : { server, path: "/ws" },
        );

        sockets.on("connection", (connection, request) => {
          const query = new URL(request.url ?? "", "http://127.0.0.1").searchParams;

          if (query.get("wsTicket") !== ticket || query.get("orchestrationProtocol") !== "2") {
            connection.close(1008);

            return;
          }

          const socket: FakeAppSocket = {
            send: (message) => connection.send(JSON.stringify(message)),
            close: () => connection.close(),
          };

          connection.on("message", (data) => {
            const bytes = Array.isArray(data)
              ? Buffer.concat(data)
              : data instanceof ArrayBuffer
                ? Buffer.from(data)
                : data;

            const message: unknown = JSON.parse(bytes.toString("utf8"));

            received.push(message);

            if (typeof message !== "object" || message === null || !("tag" in message)) {
              return;
            }

            if (message.tag === "server.updateServerWithProgress") {
              options.onPrepare(socket);
            } else if (message.tag === "server.commitDesktopUpdate") {
              (options.onCommit ?? ((open) => open.close()))(socket);
            }
          });
        });

        server.listen(0, "127.0.0.1", () => {
          const address = server.address();

          resume(
            Effect.succeed({
              server,
              port: typeof address === "object" && address !== null ? address.port : 0,
            }),
          );
        });
      },
    ),
    ({ server }) =>
      Effect.callback<void>((resume) => {
        for (const socket of stalled) {
          socket.destroy();
        }

        server.closeAllConnections();
        server.close(() => resume(Effect.void));
      }),
  ).pipe(Effect.map(({ port }) => ({ port, received })));
}

export function installFakeT3CodeCli(home: string) {
  const bin = path.join(home, "bin");
  const calls = path.join(bin, "calls");

  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(bin, "t3"),
    `#!/bin/sh
echo "$@" >> "${calls}"
if [ "$1 $2 $3" = "auth session issue" ]; then
  echo '{"sessionId":"session-1","token":"${fakeSessionToken}","method":"bearer-access-token"}'
fi
`,
  );
  chmodSync(path.join(bin, "t3"), 0o755);

  return () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
}
