import { createServer } from "node:http";
import path from "node:path";

import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { DashboardRpcs } from "@fleetfrog/protocol/dashboard/rpcs";

import { AuthRoutes } from "../auth/authRoutes.ts";
import { DashboardAuthenticationLive } from "../auth/dashboardAuthentication.ts";
import { DashboardSessions } from "../auth/dashboardSessions.ts";
import { ProjectIconStore } from "../catalogue/projectIconStore.ts";
import { nodeServer } from "../http/nodeServer.ts";
import { isCrossOrigin } from "../http/sameOrigin.ts";
import { listenOnServeSocket } from "../http/serveSocket.ts";
import { HubConfig } from "../hubConfig.ts";
import { DashboardHandlers } from "./dashboardHandlers.ts";

/** The RPC socket, for signed-in pages served from the same origin. */
const dashboardProtocol = Layer.effect(RpcServer.Protocol)(
  Effect.gen(function* () {
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    const router = yield* HttpRouter.HttpRouter;
    const sessions = yield* DashboardSessions;

    yield* router.add(
      "GET",
      "/rpc",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        if (isCrossOrigin(request)) {
          return HttpServerResponse.text("Cross-origin connections are not accepted.", {
            status: 403,
          });
        }

        const viewer = yield* sessions.viewer(request.headers).pipe(Effect.option);

        if (Option.isNone(viewer)) {
          return HttpServerResponse.text("Sign in first.", { status: 401 });
        }

        yield* sessions.connect(viewer.value, httpEffect);

        return HttpServerResponse.empty();
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

/** The dashboard port, and the socket for Tailscale Serve: the built dashboard plus its RPC WebSocket. */
export const DashboardServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* HubConfig;
    // A defect fails only its own request. By default it ends every stream on the socket, and the
    // dashboard reads that as the hub going away.
    const rpc = RpcServer.layer(DashboardRpcs, { disableFatalDefects: true }).pipe(
      Layer.provide(dashboardProtocol),
      Layer.provide([DashboardHandlers, DashboardAuthenticationLive, RpcSerialization.layerJson]),
    );
    const api = Layer.mergeAll(rpc, projectIcons, AuthRoutes);
    const routes = config.webRoot === null ? api : Layer.merge(api, dashboardFiles(config.webRoot));
    const server = createServer();
    const dashboard = HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(nodeServer(server, { port: config.dashboardPort })),
    );

    // The socket opens once the server has its routes, so Serve never reaches it without them.
    return config.dashboardSocket === null
      ? dashboard
      : Layer.effectDiscard(listenOnServeSocket(server, config.dashboardSocket)).pipe(
          Layer.provideMerge(dashboard),
        );
  }),
);
