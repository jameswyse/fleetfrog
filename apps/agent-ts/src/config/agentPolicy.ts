import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { knownNames, Tier } from "@fleetfrog/protocol/domain/action";

import { writeAuditEntry } from "../audit/auditLog.ts";
import { ConfigUnavailable, configDirectory, isMissingFile } from "./agentConfig.ts";

export const AgentPolicy = Schema.Struct({ allowedTiers: Schema.Array(Tier) });
export type AgentPolicy = typeof AgentPolicy.Type;

const PolicyFile = Schema.Struct({
  allowedTiers: knownNames(Tier),
  deniedTiers: Schema.optionalKey(knownNames(Tier)),
});
type PolicyFile = typeof PolicyFile.Type;

const allowedByDefault = { git: true, cleanup: true, update: true } satisfies Record<Tier, boolean>;

const tiersBeforeDeniedList: ReadonlyArray<Tier> = ["git", "cleanup"];

export interface ReadPolicy {
  readonly policy: AgentPolicy;
  readonly defaulted: ReadonlyArray<Tier>;
  readonly incomplete: boolean;
}

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
      await chmod(staged, 0o600);
      await rename(staged, policyPath());
    },
    catch: (error) => new ConfigUnavailable({ path: policyPath(), message: String(error) }),
  });

const auditDefaults = (defaulted: ReadonlyArray<Tier>, policy: AgentPolicy) =>
  defaulted.length === 0
    ? Effect.void
    : writeAuditEntry({
        event: "PolicyDefaultsApplied",
        allowedTiers: defaulted.filter((tier) => policy.allowedTiers.includes(tier)),
        deniedTiers: defaulted.filter((tier) => !policy.allowedTiers.includes(tier)),
      });

export const recordPolicyDefaults = Effect.gen(function* () {
  const { policy, defaulted, incomplete } = yield* readPolicy;

  if (incomplete) {
    yield* savePolicy(policy);
    yield* auditDefaults(defaulted, policy);
  }

  return defaulted;
});

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
