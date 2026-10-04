import { createServer } from "node:http";

import { describe, expect, it } from "@effect/vitest";
import { ByteSize, Context, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";

import { bodyLimit } from "./bodyLimit.ts";
import { nodeServer } from "./nodeServer.ts";
import { inlineScriptHashes, securityHeaders } from "./securityHeaders.ts";

const scriptHash = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/page", HttpServerResponse.text("hello")),
  HttpRouter.add(
    "GET",
    "/picture",
    HttpServerResponse.text("png", { headers: { "content-security-policy": "sandbox" } }),
  ),
  HttpRouter.add(
    "POST",
    "/echo",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = yield* request.text.pipe(Effect.option);

      return Option.match(body, {
        onNone: () => HttpServerResponse.text("Too large.", { status: 413 }),
        onSome: (text) => HttpServerResponse.text(text),
      });
    }),
  ),
  securityHeaders({ scriptHashes: [scriptHash] }),
  bodyLimit(ByteSize.bytes(16)),
);

/** Serves the routes on a free port for the test and gives their address. */
const served = Effect.gen(function* () {
  const context = yield* Layer.build(
    HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provideMerge(nodeServer(createServer(), { port: 0, maximumMessageBytes: 1024 })),
    ),
  );

  const { address } = Context.get(context, HttpServer.HttpServer);

  return `http://localhost:${address._tag === "UnixPathAddress" ? 0 : address.port}`;
});

describe("securityHeaders", () => {
  it.live("keeps the dashboard to its own origin and out of frames", () =>
    Effect.gen(function* () {
      const origin = yield* served;
      const response = yield* Effect.promise(() => fetch(`${origin}/page`));
      const policy = response.headers.get("content-security-policy") ?? "";

      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain(`script-src 'self' ${scriptHash}`);
      expect(policy).toContain(`connect-src 'self' ws://${new URL(origin).host} wss://`);
      expect(policy).toContain("frame-ancestors 'none'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }).pipe(Effect.scoped),
  );

  it.live("leaves a response's own policy alone", () =>
    Effect.gen(function* () {
      const origin = yield* served;
      const response = yield* Effect.promise(() => fetch(`${origin}/picture`));

      expect(response.headers.get("content-security-policy")).toBe("sandbox");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }).pipe(Effect.scoped),
  );
});

describe("bodyLimit", () => {
  it.live("reads a body within the limit and cuts off one past it", () =>
    Effect.gen(function* () {
      const origin = yield* served;

      const post = (body: string) =>
        Effect.tryPromise(() => fetch(`${origin}/echo`, { method: "POST", body }));

      const small = yield* post("x".repeat(16));

      // Node drops the connection once the body runs past the limit, so the request either fails
      // or is answered with 413.
      const refused = yield* post("x".repeat(17)).pipe(
        Effect.map((response) => response.status === 413),
        Effect.catch(() => Effect.succeed(true)),
      );

      expect(yield* Effect.promise(() => small.text())).toBe("x".repeat(16));
      expect(refused).toBe(true);
    }).pipe(Effect.scoped),
  );
});

describe("inlineScriptHashes", () => {
  it("hashes each inline script and skips ones loaded from a file", () => {
    const html = `<script></script><script type="module" src="/a.js"></script><script>
  x()
</script>`;

    expect(inlineScriptHashes(html)).toEqual([
      scriptHash,
      "'sha256-U+xbgVKp3q7OBI9O/odm2n7BIVYA/A2BRaUzCPzBKmY='",
    ]);
  });
});
