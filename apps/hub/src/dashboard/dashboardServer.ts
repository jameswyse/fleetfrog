import { createServer } from "node:http";

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

/** The dashboard port: the built dashboard plus its RPC WebSocket. */
export const DashboardServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* HubConfig;
    const rpc = RpcServer.layer(DashboardRpcs).pipe(
      Layer.provide(sameOriginProtocol),
      Layer.provide([DashboardHandlers, RpcSerialization.layerJson]),
    );
    const routes =
      config.webRoot === null
        ? rpc
        : Layer.merge(rpc, HttpStaticServer.layer({ root: config.webRoot, spa: true }));

    return HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port: config.dashboardPort })),
    );
  }),
);
