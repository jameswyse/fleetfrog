import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { runTool } from "../process/runTool.ts";

import type { T3CodeProvider, T3CodeServer } from "@fleetfrog/protocol/domain/t3Code";

const RuntimeFile = Schema.fromJsonString(
  Schema.Struct({
    pid: Schema.Int,
    port: Schema.Int,
    startedAt: Schema.DateTimeUtcFromString,
    serviceManaged: Schema.Boolean.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(false)),
      Schema.catchDecoding(() => Effect.succeedSome(false)),
    ),
  }),
);

const decodeRuntime = Schema.decodeUnknownOption(RuntimeFile);

const ProviderFile = Schema.fromJsonString(
  Schema.Struct({
    displayName: Schema.String,
    enabled: Schema.Boolean,
    status: Schema.String,
    version: Schema.NullOr(Schema.String),
    versionAdvisory: Schema.optionalKey(
      Schema.NullOr(Schema.Struct({ latestVersion: Schema.NullOr(Schema.String) })),
    ),
    auth: Schema.optionalKey(Schema.Struct({ status: Schema.String })),
  }),
);

const decodeProvider = Schema.decodeUnknownOption(ProviderFile);

const readText = (file: string) => readFile(file, "utf8").catch(() => null);

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

const executableOf = (pid: number) =>
  Effect.promise(() => readlink(`/proc/${pid}/exe`).catch(() => null)).pipe(
    Effect.flatMap((linked) =>
      linked === null
        ? runTool("ps", "/", ["-o", "comm=", "-p", String(pid)]).pipe(
            Effect.map((output) => output.trim() || null),
            Effect.catchTag("CommandFailed", () => Effect.succeed(null)),
          )
        : Effect.succeed(linked),
    ),
  );

export async function versionOf(executable: string): Promise<string | null> {
  const service = /\/runtime\/versions\/([^/]+)\//.exec(executable)?.[1];

  if (service !== undefined) {
    return service;
  }

  const app = /^(.*?\.app)\/Contents\//.exec(executable)?.[1];
  const plist = app === undefined ? null : await readText(path.join(app, "Contents", "Info.plist"));

  return (
    (plist === null
      ? undefined
      : /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]) ??
    null
  );
}

export function runtimeFilePath(userdata: string): string {
  return path.join(userdata, "server-runtime.json");
}

export const readT3CodeRuntime = Effect.fn("readT3CodeRuntime")(function* (userdata: string) {
  const text = yield* Effect.promise(() => readText(runtimeFilePath(userdata)));
  const runtime = text === null ? Option.none() : decodeRuntime(text);

  if (Option.isNone(runtime) || !isRunning(runtime.value.pid)) {
    return null;
  }

  const executable = yield* executableOf(runtime.value.pid);

  if (executable !== null && !/t3/i.test(path.basename(executable))) {
    return null;
  }

  const server: T3CodeServer = {
    version: executable === null ? null : yield* Effect.promise(() => versionOf(executable)),
    startedAt: runtime.value.startedAt,
    port: runtime.value.port,
    serviceManaged: runtime.value.serviceManaged,
  };

  return { pid: runtime.value.pid, executable, server };
});

export const readT3CodeServer = (userdata: string) =>
  readT3CodeRuntime(userdata).pipe(Effect.map((runtime) => runtime?.server ?? null));

export const readT3CodeProviders = Effect.fn("readT3CodeProviders")(function* (caches: string) {
  const files = yield* Effect.promise(() =>
    readdir(caches).then(
      (names) => names.filter((name) => name.endsWith(".json")),
      () => [],
    ),
  );

  const texts = yield* Effect.promise(() =>
    Promise.all(files.map((name) => readText(path.join(caches, name)))),
  );

  return texts
    .flatMap((text) => (text === null ? [] : Option.toArray(decodeProvider(text))))
    .filter(({ enabled }) => enabled)
    .map((provider): T3CodeProvider => {
      const latest = provider.versionAdvisory?.latestVersion ?? null;

      return {
        name: provider.displayName,
        version: provider.version,
        latestVersion: latest !== null && latest !== provider.version ? latest : null,
        ready: provider.status === "ready",
        signedIn: provider.auth?.status === "authenticated",
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
});
