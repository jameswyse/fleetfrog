import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

import { ByteSize, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { AgentRpcs } from "@fleetfrog/protocol/agent/rpcs";
import { PairingRpcs } from "@fleetfrog/protocol/pairing/rpcs";

import { bodyLimit } from "../http/bodyLimit.ts";
import { nodeServer } from "../http/nodeServer.ts";
import { HubConfig } from "../hubConfig.ts";
import { AgentCertificate } from "../pairing/agentCertificate.ts";
import { PairingHandlers } from "../pairing/pairingHandlers.ts";
import { AgentAuthenticationLive } from "./agentAuthentication.ts";
import { AgentHandlers } from "./agentHandlers.ts";

/** A pairing request carries the machine's details and a few folder paths. */
const maximumBodyBytes = ByteSize.kibibytes(64);
/** A report lists every checkout on a machine, and a project icon report carries their images. */
const maximumMessageBytes = 64 * 1024 * 1024;

const routes = Layer.mergeAll(
  RpcServer.layerHttp({ group: PairingRpcs, path: "/pair", protocol: "http" }),
  RpcServer.layerHttp({ group: AgentRpcs, path: "/agent", protocol: "websocket" }),
  bodyLimit(maximumBodyBytes),
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
    const server =
      tls === null
        ? createHttpServer()
        : createHttpsServer({ cert: tls.certificatePem, key: tls.privateKeyPem });

    return HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(
        nodeServer(server, {
          port: config.agentPort,
          host: config.host ?? undefined,
          maximumMessageBytes,
        }),
      ),
    );
  }),
);
