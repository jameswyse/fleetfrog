import { createServer } from "node:http";
import path from "node:path";

import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import {
  Headers,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { DashboardRpcs } from "@fleetfrog/protocol/dashboard/rpcs";

import { ProjectIconStore } from "../catalogue/projectIconStore.ts";
import { HubConfig } from "../hubConfig.ts";
import { DashboardHandlers } from "./dashboardHandlers.ts";

/**
 * Browsers let any page open a WebSocket to any address, so without a login the socket only
 * accepts pages served from the same origin. Clients that send no `Origin` are not browsers.
 */
function isCrossOrigin(headers: Headers.Headers): boolean {
  const origin = Headers.get(headers, "origin");

  if (Option.isNone(origin)) {
    return false;
  }

  return (
    !URL.canParse(origin.value) ||
    new URL(origin.value).host !== Headers.get(headers, "host").pipe(Option.getOrElse(() => ""))
  );
}

const sameOriginProtocol = Layer.effect(RpcServer.Protocol)(
  Effect.gen(function* () {
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    const router = yield* HttpRouter.HttpRouter;

    yield* router.add(
      "GET",
      "/rpc",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        return isCrossOrigin(request.headers)
          ? HttpServerResponse.text("Cross-origin connections are not accepted.", { status: 403 })
          : yield* httpEffect;
      }),
    );

    return protocol;
  }),
);

/**
 * The built dashboard. Its page is revalidated on every load, so a new deploy reaches browsers at
 * once; files under `/assets` have a content hash in their names, so browsers keep them for a year.
 */
function dashboardFiles(root: string) {
  return Layer.mergeAll(
    HttpStaticServer.layer({ root, spa: true, cacheControl: "no-cache" }),
    // The prefix is taken off the request's path, so this one serves from the assets folder.
    HttpStaticServer.layer({
      root: path.join(root, "assets"),
      prefix: "/assets",
      cacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/**
 * Project icons by the hash of their bytes, so browsers keep each one for good. The images come
 * from repositories, so an SVG is sandboxed and never runs a script, even opened on its own.
 */
const projectIcons = HttpRouter.add(
  "GET",
  "/project-icons/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const icon =
      id === undefined ? Option.none() : yield* ProjectIconStore.use((store) => store.find(id));

    return Option.match(icon, {
      onNone: () => HttpServerResponse.text("No such icon.", { status: 404 }),
      onSome: ({ mediaType, data }) =>
        HttpServerResponse.uint8Array(data, {
          contentType: mediaType,
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "x-content-type-options": "nosniff",
          },
        }),
    });
  }),
);

/** The dashboard port: the built dashboard plus its RPC WebSocket. */
export const DashboardServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* HubConfig;
    // A defect fails only its own request. By default it ends every stream on the socket, and the
    // dashboard reads that as the hub going away.
    const rpc = RpcServer.layer(DashboardRpcs, { disableFatalDefects: true }).pipe(
      Layer.provide(sameOriginProtocol),
      Layer.provide([DashboardHandlers, RpcSerialization.layerJson]),
    );
    const api = Layer.merge(rpc, projectIcons);
    const routes = config.webRoot === null ? api : Layer.merge(api, dashboardFiles(config.webRoot));

    return HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port: config.dashboardPort })),
    );
  }),
);
