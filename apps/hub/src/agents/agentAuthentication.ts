import { AgentAuthentication, CurrentMachine, Unauthorised } from "@fleetfrog/protocol/agent/rpcs";
import { Effect, Layer, Option } from "effect";
import { Headers } from "effect/unstable/http";

import { MachineStore } from "../machines/machineStore.ts";
import { hashAgentToken } from "../pairing/agentTokens.ts";

const bearerPrefix = "Bearer ";

/** Resolves the bearer token from the agent's WebSocket upgrade to a paired machine. */
export const AgentAuthenticationLive = Layer.effect(AgentAuthentication)(
  Effect.gen(function* () {
    const machines = yield* MachineStore;

    return (effect, { headers }) =>
      Effect.gen(function* () {
        const token = Headers.get(headers, "authorization").pipe(
          Option.filter((value) => value.startsWith(bearerPrefix)),
          Option.map((value) => value.slice(bearerPrefix.length)),
        );

        if (Option.isNone(token)) {
          return yield* new Unauthorised();
        }

        const machineId = yield* machines.findIdByTokenHash(hashAgentToken(token.value));

        if (Option.isNone(machineId)) {
          return yield* new Unauthorised();
        }

        return yield* Effect.provideService(effect, CurrentMachine, { id: machineId.value });
      });
  }),
);
