import { Effect, Schema } from "effect";

import { Count } from "./count.ts";
import { ReportedText } from "./reported.ts";

export const MachineId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("MachineId"),
);
export type MachineId = typeof MachineId.Type;

export const Platform = Schema.Literals(["linux", "darwin"]);
export type Platform = typeof Platform.Type;

export const GithubCli = Schema.TaggedUnion({
  Available: { login: ReportedText },
  Unavailable: { reason: ReportedText },
});
export type GithubCli = typeof GithubCli.Type;

const Bytes = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

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

export const MachineModel = Schema.Struct({
  name: ReportedText,
  detail: Schema.NullOr(ReportedText),
});
export type MachineModel = typeof MachineModel.Type;

export const SystemInfo = Schema.Struct({
  os: ReportedText,
  model: Schema.NullOr(MachineModel).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  kind: Schema.NullOr(MachineKind).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  hypervisor: Schema.NullOr(ReportedText).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  architecture: ReportedText,
  cpu: Schema.Struct({ model: ReportedText, cores: Count }),
  memoryBytes: Bytes,
  bootedAt: Schema.DateTimeUtc,
  versions: Schema.Struct({
    node: Schema.NullOr(ReportedText),
    git: Schema.NullOr(ReportedText),
  }),
});
export type SystemInfo = typeof SystemInfo.Type;

export const SystemUsage = Schema.Struct({
  disk: Schema.NullOr(
    Schema.Struct({
      totalBytes: Bytes,
      freeBytes: Bytes,
      purgeableBytes: Bytes.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
    }),
  ),
  memoryUsedBytes: Schema.NullOr(Bytes).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  loadAverage: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
  sampledAt: Schema.DateTimeUtc,
});
export type SystemUsage = typeof SystemUsage.Type;

export const AgentRuntime = Schema.Literals(["node", "rust"]);
export type AgentRuntime = typeof AgentRuntime.Type;

export const MachineInfo = Schema.Struct({
  hostname: ReportedText,
  prettyName: Schema.NullOr(ReportedText),
  platform: Platform,
  homeDirectory: ReportedText,
  agentVersion: ReportedText,
  agentRuntime: AgentRuntime.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed("node" as const)),
  ),
  githubCli: GithubCli,
  system: Schema.NullOr(SystemInfo).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
});
export type MachineInfo = typeof MachineInfo.Type;
