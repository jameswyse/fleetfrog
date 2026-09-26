import { Schema } from "effect";

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

/** What an agent reports about the machine it runs on. */
export const MachineInfo = Schema.Struct({
  hostname: Schema.String,
  prettyName: Schema.NullOr(Schema.String),
  platform: Platform,
  homeDirectory: Schema.String,
  agentVersion: Schema.String,
  githubCli: GithubCli,
});
export type MachineInfo = typeof MachineInfo.Type;
