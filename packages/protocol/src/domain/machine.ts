import { Effect, Schema } from "effect";

import { Count } from "./count.ts";

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

const Bytes = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/** The shape of a machine, which picks its icon. */
export const MachineKind = Schema.Literals([
  "server",
  "cloud",
  "linux",
  "desktop",
  "laptop",
  "mac-mini",
  "mac-studio",
]);
export type MachineKind = typeof MachineKind.Type;

/** The kind of machine as its maker names it, such as "MacBook Pro" and "13-inch, M1, 2020". */
export const MachineModel = Schema.Struct({
  name: Schema.String,
  detail: Schema.NullOr(Schema.String),
});
export type MachineModel = typeof MachineModel.Type;

/** Hardware and software facts that only change with an upgrade or a restart. */
export const SystemInfo = Schema.Struct({
  /** Such as "macOS 27.0" or "Ubuntu 26.04 LTS". */
  os: Schema.String,
  /** Null when the agent can't tell, and from agents that predate it. */
  model: Schema.NullOr(MachineModel).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  /**
   * The kind the agent detected from the hardware. Null without a usable signal, and from agents
   * that predate it.
   */
  kind: Schema.NullOr(MachineKind).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  /**
   * The hypervisor running the machine, such as "KVM", or null for a physical machine. Its
   * processor count is then virtual processors, not the chip's cores.
   */
  hypervisor: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  architecture: Schema.String,
  /** The chip's own name, and how many processors the system can run work on at once. */
  cpu: Schema.Struct({ model: Schema.String, cores: Count }),
  memoryBytes: Bytes,
  bootedAt: Schema.DateTimeUtc,
  /** The Node that runs the agent, or null for the Rust agent, which needs none. */
  versions: Schema.Struct({
    node: Schema.NullOr(Schema.String),
    git: Schema.NullOr(Schema.String),
  }),
});
export type SystemInfo = typeof SystemInfo.Type;

/** Measurements that drift while the machine runs. */
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

/**
 * Which agent reports a machine: the TypeScript agent in `apps/agent-ts`, which runs on Node, or the
 * native one in `apps/agent-rs`. Both speak the same protocol and share their files on the machine.
 */
export const AgentRuntime = Schema.Literals(["node", "rust"]);
export type AgentRuntime = typeof AgentRuntime.Type;

/** What an agent reports about the machine it runs on. */
export const MachineInfo = Schema.Struct({
  hostname: Schema.String,
  prettyName: Schema.NullOr(Schema.String),
  platform: Platform,
  homeDirectory: Schema.String,
  agentVersion: Schema.String,
  /** The TypeScript agent for agents that predate it. */
  agentRuntime: AgentRuntime.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed("node" as const)),
  ),
  githubCli: GithubCli,
  /** Null from agents that predate it. */
  system: Schema.NullOr(SystemInfo).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
});
export type MachineInfo = typeof MachineInfo.Type;
