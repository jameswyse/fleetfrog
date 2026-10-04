import { createServer, request } from "node:http";

import { expect, it } from "@effect/vitest";
import { Clock, Context, Duration, Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";

import { nodeServer } from "./nodeServer.ts";

const socketRoute = HttpRouter.add(
  "GET",
  "/socket",
  Effect.gen(function* () {
    const socket = yield* (yield* HttpServerRequest.HttpServerRequest).upgrade;

    return yield* Effect.scoped(
      Effect.flatMap(socket.reader, (reader) => Effect.forever(reader.pull)),
    );
  }),
);

function browser(url: string) {
  return Effect.callback<Effect.Effect<number>>((resume) => {
    const socket = new WebSocket(url);

    const closed = new Promise<number>((done) => {
      socket.addEventListener("close", (event) => done(event.code));
    });

    socket.addEventListener("open", () => resume(Effect.succeed(Effect.promise(() => closed))));
  });
}

function silentClient(port: number) {
  return Effect.callback<void>((resume) => {
    request({
      port,
      path: "/socket",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    })
      .on("upgrade", (_, socket) => {
        socket.pause();
        resume(Effect.void);
      })
      .end();
  });
}

it.live("stops promptly with WebSockets open, closing them cleanly", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();

    const context = yield* Layer.buildWithScope(
      HttpRouter.serve(socketRoute).pipe(
        Layer.provideMerge(
          nodeServer(createServer(), {
            port: 0,
            shutdownGrace: Duration.millis(200),
            maximumMessageBytes: 1024,
          }),
        ),
      ),
      scope,
    );

    const { address } = Context.get(context, HttpServer.HttpServer);
    const port = address._tag === "UnixPathAddress" ? 0 : address.port;
    const closed = yield* browser(`ws://localhost:${port}/socket`);

    yield* silentClient(port);

    const start = yield* Clock.currentTimeMillis;

    yield* Scope.close(scope, Exit.void);

    expect((yield* Clock.currentTimeMillis) - start).toBeLessThan(2000);
    expect(yield* closed).not.toBe(1006);
  }),
);
