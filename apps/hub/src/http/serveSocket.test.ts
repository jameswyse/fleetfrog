import { mkdtempSync, rmdirSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  clientAddress,
  decodeHeaderWords,
  listenOnServeSocket,
  requestHost,
  tailscaleIdentity,
} from "./serveSocket.ts";

/** Answers with what the hub makes of each request. */
const probe = HttpRouter.add(
  "GET",
  "/probe",
  Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;

    return yield* HttpServerResponse.json({
      identity: Option.getOrNull(tailscaleIdentity(incoming)),
      host: Option.getOrNull(requestHost(incoming)),
      address: Option.getOrNull(clientAddress(incoming)),
    });
  }),
);

/** What Serve sends, and what anyone else on the tailnet could send straight to the hub's port. */
const serveHeaders = {
  "tailscale-user-login": "ada@example.com",
  "tailscale-user-name": "Ada",
  "x-forwarded-host": "fleetfrog.tail1234.ts.net",
  "x-forwarded-for": "100.64.0.7",
};

function get(target: { readonly port: number } | { readonly socketPath: string }) {
  return Effect.callback<unknown>((resume) => {
    request({ ...target, path: "/probe", headers: serveHeaders }, (response) => {
      let body = "";

      response.on("data", (chunk: Buffer) => (body += chunk.toString()));
      response.on("end", () => resume(Effect.succeed(JSON.parse(body))));
    }).end();
  });
}

describe("the dashboard socket", () => {
  it.effect("trusts Serve's headers only on connections through the socket", () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(path.join(tmpdir(), "fleetfrog-serve-"));
      const socketPath = path.join(folder, "dashboard.sock");
      const server = createServer();

      yield* Effect.addFinalizer(() => Effect.sync(() => rmdirSync(folder)));
      const context = yield* Layer.build(
        Layer.effectDiscard(listenOnServeSocket(server, socketPath)).pipe(
          Layer.provideMerge(HttpRouter.serve(probe)),
          Layer.provideMerge(NodeHttpServer.layer(() => server, { port: 0, host: "127.0.0.1" })),
        ),
      );
      const { address } = Context.get(context, HttpServer.HttpServer);
      const port = address._tag === "UnixPathAddress" ? 0 : address.port;

      expect(yield* get({ port })).toEqual({
        identity: null,
        host: `localhost:${port}`,
        address: "127.0.0.1",
      });
      expect(yield* get({ socketPath })).toEqual({
        identity: { login: "ada@example.com", name: "Ada" },
        host: "fleetfrog.tail1234.ts.net",
        address: "100.64.0.7",
      });
    }).pipe(Effect.scoped),
  );
});

describe("decodeHeaderWords", () => {
  it("leaves plain values as they are", () => {
    expect(decodeHeaderWords("Ada Lovelace")).toBe("Ada Lovelace");
  });

  it("decodes the words Tailscale uses for names outside ASCII", () => {
    expect(decodeHeaderWords("=?utf-8?q?Zo=C3=AB_M=C3=BCller?=")).toBe("Zoë Müller");
    // Go splits long values into several words, and the spaces between them aren't part of it.
    expect(decodeHeaderWords("=?utf-8?q?Zo=C3=AB?= =?utf-8?q?_M=C3=BCller=5F?=")).toBe(
      "Zoë Müller_",
    );
    expect(decodeHeaderWords("=?utf-8?q?Zo=C3=AB?= Smith")).toBe("Zoë Smith");
  });
});
