import { Console, Effect } from "effect";
import { Argument, Command } from "effect/cli";

import { Tier } from "@fleetfrog/protocol/domain/action";

import { changePolicy, policyPath } from "../config/agentPolicy.ts";
import { reportFailure } from "./reportFailure.ts";

export const tierDescriptions = {
  git: "Git actions: fetch, pull (fast-forward only), clone into a project folder, switch branches and stash changes",
  cleanup:
    "Cleanup actions: delete branches, archive checkouts, move them to the trash or delete them, and restore or empty the trash",
  update: "Agent updates: let the hub update this agent to the hub's version",
} satisfies Record<Tier, string>;

const tierPluralNames = {
  git: "Git actions",
  cleanup: "Cleanup actions",
  update: "Agent updates",
} satisfies Record<Tier, string>;

const tierArgument = Argument.Literals("tier", Tier.literals).pipe(
  Argument.withDescription(
    Tier.literals.map((tier) => `${tier}: ${tierDescriptions[tier]}`).join("\n"),
  ),
);

function setTier(options: { readonly tier: Tier; readonly change: "allow" | "deny" }) {
  const verb = options.change === "allow" ? "allowed" : "denied";

  return changePolicy(
    options.change === "allow"
      ? { allow: [options.tier], deny: [] }
      : { allow: [], deny: [options.tier] },
  ).pipe(
    Effect.flatMap(({ changed, replacedDamaged }) =>
      Console.log(
        [
          replacedDamaged &&
            `The saved policy at ${policyPath()} couldn't be read, so it was replaced.`,
          changed
            ? `${tierPluralNames[options.tier]} are now ${verb} on this machine. The hub sees the change within 15 seconds.`
            : `${tierPluralNames[options.tier]} were already ${verb} on this machine.`,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ),
    Effect.catchTag("ConfigUnavailable", ({ path, message }) =>
      reportFailure(`Could not update the policy at ${path}: ${message}`),
    ),
  );
}

export const allowCommand = Command.make("allow", { tier: tierArgument }, ({ tier }) =>
  setTier({ tier, change: "allow" }),
).pipe(
  Command.withDescription(`Let the hub run a tier of actions here (saved in ${policyPath()})`),
);

export const denyCommand = Command.make("deny", { tier: tierArgument }, ({ tier }) =>
  setTier({ tier, change: "deny" }),
).pipe(Command.withDescription("Stop the hub from running a tier of actions here"));
