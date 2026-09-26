import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { Tier } from "@fleetfrog/protocol/domain/action";
import { pairingCodeLifetimeMinutes } from "@fleetfrog/protocol/pairing/pairingString";

import { configPath } from "../config/agentConfig.ts";
import { changePolicy } from "../config/agentPolicy.ts";
import { pairWithHub } from "../connection/pairWithHub.ts";
import { tierDescriptions } from "./policyCommands.ts";
import { reportFailure } from "./reportFailure.ts";

export const pairCommand = Command.make(
  "pair",
  {
    pairingString: Argument.String("pairing-string").pipe(
      Argument.withDescription("The string shown when pairing a machine in the dashboard"),
    ),
    insecure: Flag.Boolean("insecure").pipe(
      Flag.withDescription("Allow an unencrypted connection to a hub on another machine"),
      Flag.withDefault(false),
    ),
    allow: Flag.Literals("allow", Tier.literals).pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        `Allow a tier of actions from the start, as \`fleetfrog allow\` does. Repeatable. ${Tier.literals
          .map((tier) => `${tier}: ${tierDescriptions[tier]}`)
          .join("; ")}`,
      ),
    ),
  },
  ({ pairingString, insecure, allow }) =>
    Effect.scoped(pairWithHub({ pairingString, insecure })).pipe(
      Effect.tap(() => changePolicy({ allow, deny: [] })),
      Effect.flatMap((machineId) =>
        Console.log(
          `Paired as machine ${machineId}. Credentials saved to ${configPath()}.\nRun \`fleetfrog service install\` to keep the agent running, or \`fleetfrog run\` to try it in this terminal.`,
        ),
      ),
      Effect.catchTags({
        PairingRefused: ({ message }) => reportFailure(message),
        InvalidPairingCode: () =>
          reportFailure(
            `The hub rejected the pairing code. Codes work once and expire after ${pairingCodeLifetimeMinutes} minutes.`,
          ),
        CertificateMismatch: () =>
          reportFailure(
            "The hub's certificate does not match the pairing string. Nothing was sent. Check that you are pairing with the right hub.",
          ),
        ConfigUnavailable: ({ path, message }) =>
          reportFailure(`Could not save the pairing to ${path}: ${message}`),
        HubUnreachable: ({ message }) => reportFailure(`Could not reach the hub: ${message}`),
        RpcClientError: ({ message }) => reportFailure(`Could not reach the hub: ${message}`),
      }),
    ),
).pipe(Command.withDescription("Pair this machine with a FleetFrog hub"));
