import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { knownNames, Tier } from "@fleetfrog/protocol/domain/action";

import { writeAuditEntry } from "../audit/auditLog.ts";
import { ConfigUnavailable, configDirectory, isMissingFile } from "./agentConfig.ts";

/**
 * Which tiers of actions the machine's owner allows, with every tier this agent knows decided. It
 * lives in its own file so that pairing again keeps it, and only a command run on this machine
 * changes it.
 */
export const AgentPolicy = Schema.Struct({ allowedTiers: Schema.Array(Tier) });
export type AgentPolicy = typeof AgentPolicy.Type;

/**
 * The policy file. It lists denied tiers as well as allowed ones, so a tier in neither is one the
 * owner hasn't decided, such as one added after the file was written. Tiers this agent doesn't
 * know, from a newer agent, are left out rather than making the file unreadable.
 */
const PolicyFile = Schema.Struct({
  allowedTiers: knownNames(Tier),
  /** Absent from files written before it, when `git` and `cleanup` were the only tiers. */
  deniedTiers: Schema.optionalKey(knownNames(Tier)),
});
type PolicyFile = typeof PolicyFile.Type;

/**
 * Whether each tier is allowed on a machine whose owner hasn't decided. The agent records this in
 * the policy the first time it meets the tier, so changing a default later leaves existing machines
 * as they were.
 */
const allowedByDefault = { git: true, cleanup: true, update: true } satisfies Record<Tier, boolean>;

/** The tiers that existed before the policy listed denied tiers. A file without that list denied each of these it didn't allow. */
const tiersBeforeDeniedList: ReadonlyArray<Tier> = ["git", "cleanup"];

/** What the policy file says, with each undecided tier given its default. */
export interface ReadPolicy {
  readonly policy: AgentPolicy;
  /** Tiers that took their default because the file didn't decide them. */
  readonly defaulted: ReadonlyArray<Tier>;
  /**
   * Whether the file needs writing to record every decision: it's missing, predates the denied
   * list or leaves a tier undecided.
   */
  readonly incomplete: boolean;
}

/**
 * Decides every tier from the file, or from defaults when there is none. A denial wins over an
 * allowance of the same tier.
 */
export function decidePolicy(file: PolicyFile | null): ReadPolicy {
  const allowed = file?.allowedTiers ?? [];

  const denied =
    file === null
      ? []
      : (file.deniedTiers ?? tiersBeforeDeniedList.filter((tier) => !allowed.includes(tier)));

  const defaulted = Tier.literals.filter(
    (tier) => !allowed.includes(tier) && !denied.includes(tier),
  );

  const allowedTiers = Tier.literals.filter(
    (tier) =>
      !denied.includes(tier) &&
      (allowed.includes(tier) || (defaulted.includes(tier) && allowedByDefault[tier])),
  );

  return {
    policy: { allowedTiers },
    defaulted,
    incomplete: defaulted.length > 0 || file?.deniedTiers === undefined,
  };
}

const PolicyJson = Schema.fromJsonString(PolicyFile);
const decodePolicy = Schema.decodeUnknownEffect(PolicyJson);
const encodePolicy = Schema.encodeSync(PolicyJson);

export function policyPath(): string {
  return path.join(configDirectory(), "policy.json");
}

const readPolicy = Effect.gen(function* () {
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
    return decidePolicy(null);
  }

  return yield* decodePolicy(contents).pipe(
    Effect.map(decidePolicy),
    Effect.mapError(
      () => new ConfigUnavailable({ path: file, message: "The saved policy is not valid." }),
    ),
  );
});

/**
 * The saved policy, with each tier it doesn't decide at its default. A damaged file fails rather
 * than guessing.
 */
export const loadPolicy = readPolicy.pipe(Effect.map(({ policy }) => policy));

export const savePolicy = (policy: AgentPolicy) =>
  Effect.tryPromise({
    try: async () => {
      const staged = `${policyPath()}.${process.pid}.tmp`;

      const contents = encodePolicy({
        allowedTiers: Tier.literals.filter((tier) => policy.allowedTiers.includes(tier)),
        deniedTiers: Tier.literals.filter((tier) => !policy.allowedTiers.includes(tier)),
      });

      await mkdir(configDirectory(), { recursive: true, mode: 0o700 });
      await writeFile(staged, `${contents}\n`, { mode: 0o600 });
      // Only the owner may widen what the hub can ask for.
      await chmod(staged, 0o600);
      // The running agent reads the policy at any moment, so it must never see half a file.
      await rename(staged, policyPath());
    },
    catch: (error) => new ConfigUnavailable({ path: policyPath(), message: String(error) }),
  });

/** Records in the audit log the tiers that took their default in `policy`. */
const auditDefaults = (defaulted: ReadonlyArray<Tier>, policy: AgentPolicy) =>
  defaulted.length === 0
    ? Effect.void
    : writeAuditEntry({
        event: "PolicyDefaultsApplied",
        allowedTiers: defaulted.filter((tier) => policy.allowedTiers.includes(tier)),
        deniedTiers: defaulted.filter((tier) => !policy.allowedTiers.includes(tier)),
      });

/**
 * Writes each tier the policy doesn't decide into it at its default, so a later change to that
 * default leaves this machine as it is. Returns the tiers that took their default.
 */
export const recordPolicyDefaults = Effect.gen(function* () {
  const { policy, defaulted, incomplete } = yield* readPolicy;

  if (incomplete) {
    yield* savePolicy(policy);
    yield* auditDefaults(defaulted, policy);
  }

  return defaulted;
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
  const current = yield* readPolicy.pipe(Effect.option);

  const { policy, defaulted, incomplete } = Option.getOrElse(current, (): ReadPolicy => ({
    policy: { allowedTiers: [] },
    defaulted: [],
    incomplete: true,
  }));

  const replacedDamaged = Option.isNone(current);

  const allowedTiers = Tier.literals.filter(
    (tier) =>
      !change.deny.includes(tier) &&
      (policy.allowedTiers.includes(tier) || change.allow.includes(tier)),
  );

  const changed =
    replacedDamaged ||
    allowedTiers.length !== policy.allowedTiers.length ||
    allowedTiers.some((tier) => !policy.allowedTiers.includes(tier));

  // Saving also records any defaults the file didn't have yet.
  if (changed || incomplete) {
    yield* savePolicy({ allowedTiers });
    yield* auditDefaults(
      defaulted.filter((tier) => !change.allow.includes(tier) && !change.deny.includes(tier)),
      { allowedTiers },
    );
  }

  if (changed) {
    yield* writeAuditEntry({ event: "PolicyChanged", allowedTiers });
  }

  return { allowedTiers, changed, replacedDamaged };
});
