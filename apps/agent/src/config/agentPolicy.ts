import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { Tier } from "@fleetfrog/protocol/domain/action";

import { writeAuditEntry } from "../audit/auditLog.ts";
import { ConfigUnavailable, configDirectory, isMissingFile } from "./agentConfig.ts";

/**
 * Which tiers of actions the machine's owner allows. It lives in its own file so that pairing again
 * keeps it, and only a command run on this machine changes it.
 */
export const AgentPolicy = Schema.Struct({ allowedTiers: Schema.Array(Tier) });
export type AgentPolicy = typeof AgentPolicy.Type;

/** Every tier is allowed until the owner denies it. */
export const defaultPolicy: AgentPolicy = { allowedTiers: ["git", "cleanup"] };

const PolicyJson = Schema.fromJsonString(AgentPolicy);
const decodePolicy = Schema.decodeUnknownEffect(PolicyJson);
const encodePolicy = Schema.encodeSync(PolicyJson);

export function policyPath(): string {
  return path.join(configDirectory(), "policy.json");
}

/** The saved policy, or the default when there is none. A damaged file fails rather than guessing. */
export const loadPolicy = Effect.gen(function* () {
  const file = policyPath();
  const contents = yield* Effect.tryPromise({
    try: () =>
      readFile(file, "utf8").then(
        (text): string | null => text,
        (error: unknown) => {
          if (isMissingFile(error)) {
            return null;
          }

          throw error;
        },
      ),
    catch: (error) => new ConfigUnavailable({ path: file, message: String(error) }),
  });

  if (contents === null) {
    return defaultPolicy;
  }

  return yield* decodePolicy(contents).pipe(
    Effect.mapError(
      () => new ConfigUnavailable({ path: file, message: "The saved policy is not valid." }),
    ),
  );
});

export const savePolicy = (policy: AgentPolicy) =>
  Effect.tryPromise({
    try: async () => {
      const staged = `${policyPath()}.${process.pid}.tmp`;

      await mkdir(configDirectory(), { recursive: true, mode: 0o700 });
      await writeFile(staged, `${encodePolicy(policy)}\n`, { mode: 0o600 });
      // Only the owner may widen what the hub can ask for.
      await chmod(staged, 0o600);
      // The running agent reads the policy at any moment, so it must never see half a file.
      await rename(staged, policyPath());
    },
    catch: (error) => new ConfigUnavailable({ path: policyPath(), message: String(error) }),
  });

/**
 * Allows and denies tiers, then saves and records the policy only if that changed it. A damaged
 * policy allows nothing, so the change starts from nothing and replaces it. Returns the tiers
 * allowed afterwards, whether anything changed and whether a damaged policy was replaced.
 */
export const changePolicy = Effect.fn("changePolicy")(function* (change: {
  readonly allow: ReadonlyArray<Tier>;
  readonly deny: ReadonlyArray<Tier>;
}) {
  const current = yield* loadPolicy.pipe(Effect.option);
  const policy = Option.getOrElse(current, (): AgentPolicy => ({ allowedTiers: [] }));
  const replacedDamaged = Option.isNone(current);
  const allowed = new Set(policy.allowedTiers);

  for (const tier of change.allow) {
    allowed.add(tier);
  }

  for (const tier of change.deny) {
    allowed.delete(tier);
  }

  const allowedTiers = [...allowed];
  const changed =
    replacedDamaged ||
    allowedTiers.length !== policy.allowedTiers.length ||
    allowedTiers.some((tier) => !policy.allowedTiers.includes(tier));

  if (changed) {
    yield* savePolicy({ allowedTiers });
    yield* writeAuditEntry({ event: "PolicyChanged", allowedTiers });
  }

  return { allowedTiers, changed, replacedDamaged };
});
