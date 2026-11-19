import { createServer, request } from "node:http";
import { connect } from "node:net";

import { expect, it } from "@effect/vitest";
import { Clock, Context, Duration, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";

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
    const scope = yield* Scope.fork(yield* Scope.Scope);

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

const uploadRoute = HttpRouter.add("POST", "/upload", Effect.succeed(HttpServerResponse.empty()));

const unfinishedUpload = Effect.fnUntraced(function* (port: number) {
  const upload = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const client = connect(port, "127.0.0.1");

      const responded = new Promise<void>((resolve, reject) => {
        const closedEarly = () =>
          reject(new Error("The server closed the upload before responding."));

        client.once("close", closedEarly);
        client.once("error", reject);
        client.once("data", () => {
          client.off("close", closedEarly);
          resolve();
        });
      });

      const closed = new Promise<void>((done) => client.once("close", () => done()));

      client.write("POST /upload HTTP/1.1\r\nhost: localhost\r\ncontent-length: 1000\r\n\r\npart");

      return { client, responded, closed };
    }),
    ({ client }) => Effect.sync(() => client.destroy()),
  );

  yield* Effect.promise(() => upload.responded);

  return Effect.promise(() => upload.closed);
});

it.live("cuts off a connection still sending a request once the grace period ends", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Scope.Scope);

    const context = yield* Layer.buildWithScope(
      HttpRouter.serve(uploadRoute).pipe(
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
    const closed = yield* unfinishedUpload(port);

    const [elapsed, closing] = yield* Effect.gen(function* () {
      const closingScope = yield* Effect.forkDetach(Scope.close(scope, Exit.void));

      yield* closed.pipe(Effect.timeout(Duration.seconds(2)));

      return closingScope;
    }).pipe(Effect.timed);

    expect(Duration.toMillis(elapsed)).toBeGreaterThanOrEqual(150);

    yield* Fiber.join(closing);
  }),
);
