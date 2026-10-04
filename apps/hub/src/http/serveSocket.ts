import { lstat, unlink } from "node:fs/promises";
import { createServer } from "node:net";

import { NodeHttpServerRequest } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
import { Headers } from "effect/http";

import type { Server } from "node:http";
import type { Socket } from "node:net";

import type { HttpServerRequest } from "effect/http";

import type { TailscaleIdentity } from "@fleetfrog/protocol/dashboard/auth";

/**
 * Connections accepted on the dashboard socket. Only Tailscale Serve reaches it, so their requests
 * carry headers Serve sets itself. The same headers on any other connection could be forged:
 * Tailscale in userspace mode forwards other tailnet machines straight to the dashboard's port.
 */
const serveConnections = new WeakSet<Socket>();

/** The hub couldn't listen on the dashboard socket, such as when its folder isn't writable. */
export class ServeSocketError extends Schema.TaggedError<ServeSocketError>()("ServeSocketError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Hands connections on a Unix socket to the dashboard's HTTP server, marked as coming from Serve. */
export const listenOnServeSocket = Effect.fnUntraced(function* (server: Server, path: string) {
  // A socket left by a hub that stopped without closing it would block listening.
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
    // Stops new connections without waiting for open ones, which the HTTP server owns and closes.
    (listener) => Effect.sync(() => listener.close()),
  );
  yield* Effect.logInfo(`Listening for Tailscale Serve on ${path}`);
});

function fromServe(request: HttpServerRequest.HttpServerRequest): boolean {
  return serveConnections.has(NodeHttpServerRequest.toIncomingMessage(request).socket);
}

/**
 * The host the browser asked for. Serve sends `Host: localhost` to a socket, and the browser's host
 * in `X-Forwarded-Host`.
 */
export function requestHost(request: HttpServerRequest.HttpServerRequest): Option.Option<string> {
  return Headers.get(request.headers, fromServe(request) ? "x-forwarded-host" : "host");
}

/** The client's address, which for a request through Serve is its tailnet address. */
export function clientAddress(request: HttpServerRequest.HttpServerRequest): Option.Option<string> {
  return fromServe(request)
    ? Headers.get(request.headers, "x-forwarded-for")
    : request.remoteAddress;
}

/** A value Tailscale may have encoded as RFC 2047 words, such as `=?utf-8?q?Zo=C3=AB?=`. */
export function decodeHeaderWords(value: string): string {
  // Only the space between two encoded words is dropped; a space beside plain text stays.
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

/**
 * The tailnet user Tailscale Serve says sent the request. None for requests that didn't come
 * through Serve, and for devices with tags rather than an owner, which Serve sends no user for.
 */
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
