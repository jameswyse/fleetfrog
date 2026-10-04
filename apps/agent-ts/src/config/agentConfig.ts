import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { instanceNamed } from "./agentInstance.ts";
import { configDirectoryOverride, configHome } from "./environment.ts";

export const AgentConfig = Schema.Struct({
  agentUrl: Schema.String,
  machineId: MachineId,
  token: Schema.String,
  certificatePem: Schema.NullOr(Schema.String),
});
export type AgentConfig = typeof AgentConfig.Type;

const AgentConfigJson = Schema.fromJsonString(AgentConfig);
const decodeConfig = Schema.decodeUnknownEffect(AgentConfigJson);
const encodeConfig = Schema.encodeSync(AgentConfigJson);

export function configDirectory(): string {
  return configDirectoryOverride() ?? path.join(configHome(), instanceNamed("fleetfrog"));
}

export function configPath(): string {
  return path.join(configDirectory(), "agent.json");
}

export class ConfigUnavailable extends Schema.TaggedError<ConfigUnavailable>()(
  "ConfigUnavailable",
  { path: Schema.String, message: Schema.String },
) {}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export const loadAgentConfig = Effect.gen(function* () {
  const file = configPath();

  const contents = yield* Effect.tryPromise({
    try: () =>
      readFile(file, "utf8").then(Option.some, (error: unknown) => {
        if (isMissingFile(error)) {
          return Option.none<string>();
        }

        throw error;
      }),
    catch: (error) => new ConfigUnavailable({ path: file, message: String(error) }),
  });

  if (Option.isNone(contents)) {
    return Option.none<AgentConfig>();
  }

  return Option.some(
    yield* decodeConfig(contents.value).pipe(
      Effect.mapError(
        () => new ConfigUnavailable({ path: file, message: "The saved pairing is not valid." }),
      ),
    ),
  );
});

export const ensureConfigWritable = Effect.tryPromise({
  try: async () => {
    await mkdir(configDirectory(), { recursive: true, mode: 0o700 });
    await access(configDirectory(), constants.W_OK);
  },
  catch: (error) => new ConfigUnavailable({ path: configDirectory(), message: String(error) }),
});

export const saveAgentConfig = (config: AgentConfig) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(configDirectory(), { recursive: true, mode: 0o700 });
      await writeFile(configPath(), `${encodeConfig(config)}\n`, { mode: 0o600 });
      await chmod(configDirectory(), 0o700);
      await chmod(configPath(), 0o600);
    },
    catch: (error) => new ConfigUnavailable({ path: configPath(), message: String(error) }),
  });
