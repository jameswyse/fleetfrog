import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { AgentRpcs } from "@fleetfrog/protocol/agent/rpcs";
import { PairingRpcs } from "@fleetfrog/protocol/pairing/rpcs";

import { HubConfig } from "../hubConfig.ts";
import { AgentCertificate } from "../pairing/agentCertificate.ts";
import { PairingHandlers } from "../pairing/pairingHandlers.ts";
import { AgentAuthenticationLive } from "./agentAuthentication.ts";
import { AgentHandlers } from "./agentHandlers.ts";

const routes = Layer.mergeAll(
  RpcServer.layerHttp({ group: PairingRpcs, path: "/pair", protocol: "http" }),
  RpcServer.layerHttp({ group: AgentRpcs, path: "/agent", protocol: "websocket" }),
).pipe(
  Layer.provide([
    PairingHandlers,
    AgentHandlers,
    AgentAuthenticationLive,
    RpcSerialization.layerJson,
  ]),
);

/** The agent port: pairing over HTTPS and agent connections over secure WebSocket. */
export const AgentServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* HubConfig;
    const { tls } = yield* AgentCertificate;
    const createServer =
      tls === null
        ? () => createHttpServer()
        : () => createHttpsServer({ cert: tls.certificatePem, key: tls.privateKeyPem });

    return HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port: config.agentPort })),
    );
  }),
);
