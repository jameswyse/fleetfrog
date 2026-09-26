import { Effect, Schema } from "effect";

export const MachineId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("MachineId"),
);
export type MachineId = typeof MachineId.Type;

export const Platform = Schema.Literals(["linux", "darwin"]);
export type Platform = typeof Platform.Type;

export const GithubCli = Schema.TaggedUnion({
  Available: { login: Schema.String },
  Unavailable: { reason: Schema.String },
});
export type GithubCli = typeof GithubCli.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Bytes = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/** Hardware and software facts that only change with an upgrade or a restart. */
export const SystemInfo = Schema.Struct({
  /** Such as "macOS 27.0" or "Ubuntu 26.04 LTS". */
  os: Schema.String,
  architecture: Schema.String,
  cpu: Schema.Struct({ model: Schema.String, cores: Count }),
  memoryBytes: Bytes,
  bootedAt: Schema.DateTimeUtc,
  versions: Schema.Struct({ node: Schema.String, git: Schema.NullOr(Schema.String) }),
});
export type SystemInfo = typeof SystemInfo.Type;

/** Measurements that drift while the machine runs, reported every minute. */
export const SystemUsage = Schema.Struct({
  /** The file system holding the home directory. */
  disk: Schema.NullOr(Schema.Struct({ totalBytes: Bytes, freeBytes: Bytes })),
  /**
   * Memory in use, leaving out caches the system can reclaim, as Activity Monitor and `free` count
   * it. Null when it can't be read, and from agents that predate it.
   */
  memoryUsedBytes: Schema.NullOr(Bytes).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  /** Over the last 1, 5 and 15 minutes. */
  loadAverage: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
  sampledAt: Schema.DateTimeUtc,
});
export type SystemUsage = typeof SystemUsage.Type;

/** What an agent reports about the machine it runs on. */
export const MachineInfo = Schema.Struct({
  hostname: Schema.String,
  prettyName: Schema.NullOr(Schema.String),
  platform: Platform,
  homeDirectory: Schema.String,
  agentVersion: Schema.String,
  githubCli: GithubCli,
  /** Null from agents that predate it. */
  system: Schema.NullOr(SystemInfo).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
});
export type MachineInfo = typeof MachineInfo.Type;
