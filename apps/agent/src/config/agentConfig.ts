import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { Effect, Option, Schema } from "effect";

/** What pairing leaves behind: where the hub is, how to recognise it and how to prove who we are. */
export const AgentConfig = Schema.Struct({
  agentUrl: Schema.String,
  machineId: MachineId,
  token: Schema.String,
  /** The hub's pinned self-signed certificate, absent when the hub uses a publicly trusted one. */
  certificatePem: Schema.NullOr(Schema.String),
});
export type AgentConfig = typeof AgentConfig.Type;

const AgentConfigJson = Schema.fromJsonString(AgentConfig);
const decodeConfig = Schema.decodeUnknownEffect(AgentConfigJson);
const encodeConfig = Schema.encodeSync(AgentConfigJson);

export function configDirectory(): string {
  return (
    process.env.FLEETFROG_CONFIG_DIR ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "fleetfrog")
  );
}

export function configPath(): string {
  return path.join(configDirectory(), "agent.json");
}

/** The saved pairing, or `None` before the machine is paired. */
export const loadAgentConfig = Effect.gen(function* () {
  const contents = yield* Effect.promise(() =>
    readFile(configPath(), "utf8").then(
      (text) => Option.some(text),
      () => Option.none<string>(),
    ),
  );

  if (Option.isNone(contents)) {
    return Option.none<AgentConfig>();
  }

  return Option.some(yield* decodeConfig(contents.value).pipe(Effect.orDie));
});

/** Saves the pairing readable only by the current user, since it holds the agent's token. */
export const saveAgentConfig = (config: AgentConfig) =>
  Effect.promise(async () => {
    await mkdir(configDirectory(), { recursive: true, mode: 0o700 });
    await writeFile(configPath(), `${encodeConfig(config)}\n`, { mode: 0o600 });
  });
