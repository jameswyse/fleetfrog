import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { PairingRpcs } from "@fleetfrog/protocol/pairing/rpcs";

import { ActivityFeed } from "../activity/activityFeed.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { issueAgentToken } from "./agentTokens.ts";
import { PairingOffers } from "./pairingOffers.ts";

export const PairingHandlers = PairingRpcs.toLayer(
  Effect.gen(function* () {
    const offers = yield* PairingOffers;
    const machines = yield* MachineStore;
    const feed = yield* FleetFeed;
    const activity = yield* ActivityFeed;

    return {
      Pair: ({ code, info, suggestedRoots }) =>
        Effect.gen(function* () {
          yield* offers.redeem(code);

          const machineId = MachineId.make(randomUUID());
          const { token, tokenHash } = issueAgentToken();

          yield* machines.create({
            id: machineId,
            tokenHash,
            info,
            discoveryRoots: suggestedRoots,
          });
          yield* feed.invalidate;
          yield* activity.recordEvent(
            {
              _tag: "MachinePaired",
              machineId,
              machineName: machineLabel({ customName: null, info }),
            },
            null,
          );
          yield* Effect.logInfo("Paired machine").pipe(
            Effect.annotateLogs({ machineId, hostname: info.hostname }),
          );

          return { machineId, token };
        }),
    };
  }),
);
