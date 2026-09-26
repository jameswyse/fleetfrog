import { createServer } from "node:http";

import { NodeHttpServer } from "@effect/platform-node";
import { DashboardRpcs } from "@fleetfrog/protocol/dashboard/rpcs";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { HubConfig } from "../hubConfig.ts";
import { DashboardHandlers } from "./dashboardHandlers.ts";

/** The dashboard port: the built dashboard plus its RPC WebSocket. */
export const DashboardServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* HubConfig;
    const rpc = RpcServer.layerHttp({ group: DashboardRpcs, path: "/rpc" }).pipe(
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
