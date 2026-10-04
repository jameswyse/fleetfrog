import { lstat, unlink } from "node:fs/promises";
import { createServer } from "node:net";

import { NodeHttpServerRequest } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
import { Headers } from "effect/http";

import type { Server } from "node:http";
import type { Socket } from "node:net";

import type { HttpServerRequest } from "effect/http";

import type { TailscaleIdentity } from "@fleetfrog/protocol/dashboard/auth";

const serveConnections = new WeakSet<Socket>();

export class ServeSocketError extends Schema.TaggedError<ServeSocketError>()("ServeSocketError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export const listenOnServeSocket = Effect.fnUntraced(function* (server: Server, path: string) {
  yield* Effect.promise(() =>
    lstat(path).then(
      (stats) => (stats.isSocket() ? unlink(path) : undefined),
      () => undefined,
    ),
  );
  yield* Effect.acquireRelease(
    Effect.callback<ReturnType<typeof createServer>, ServeSocketError>((resume) => {
      const listener = createServer((socket) => {
        serveConnections.add(socket);
        server.emit("connection", socket);
      });

      const onError = (cause: Error) => resume(Effect.fail(new ServeSocketError({ path, cause })));

      listener.once("error", onError);
      listener.listen(path, () => {
        listener.off("error", onError);
        resume(Effect.succeed(listener));
      });
    }),
    (listener) => Effect.sync(() => listener.close()),
  );
  yield* Effect.logInfo(`Listening for Tailscale Serve on ${path}`);
});

function fromServe(request: HttpServerRequest.HttpServerRequest): boolean {
  return serveConnections.has(NodeHttpServerRequest.toIncomingMessage(request).socket);
}

export function requestHost(request: HttpServerRequest.HttpServerRequest): Option.Option<string> {
  return Headers.get(request.headers, fromServe(request) ? "x-forwarded-host" : "host");
}

export function clientAddress(request: HttpServerRequest.HttpServerRequest): Option.Option<string> {
  return fromServe(request)
    ? Headers.get(request.headers, "x-forwarded-for")
    : request.remoteAddress;
}

export function decodeHeaderWords(value: string): string {
  const joined = value.replaceAll(/\?=\s+=\?/gu, "?==?");

  return joined.replaceAll(/=\?utf-8\?q\?([^?]*)\?=/giu, (_, encoded: string) => {
    const bytes = encoded
      .replaceAll("_", " ")
      .split(/(=[0-9A-F]{2})/iu)
      .flatMap((part) =>
        /^=[0-9A-F]{2}$/iu.test(part)
          ? [Number.parseInt(part.slice(1), 16)]
          : [...new TextEncoder().encode(part)],
      );

    return new TextDecoder().decode(new Uint8Array(bytes));
  });
}

export function tailscaleIdentity(
  request: HttpServerRequest.HttpServerRequest,
): Option.Option<TailscaleIdentity> {
  if (!fromServe(request)) {
    return Option.none();
  }

  return Headers.get(request.headers, "tailscale-user-login").pipe(
    Option.map(decodeHeaderWords),
    Option.filter((login) => login !== ""),
    Option.map((login) => ({
      login,
      name: Headers.get(request.headers, "tailscale-user-name").pipe(
        Option.map(decodeHeaderWords),
        Option.filter((name) => name !== ""),
        Option.getOrElse(() => login),
      ),
    })),
  );
}
