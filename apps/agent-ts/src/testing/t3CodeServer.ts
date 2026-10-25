import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import { temporaryDirectory } from "./temporaryDirectory.ts";

export function startT3CodeProcess(version = "0.0.46") {
  return Effect.gen(function* () {
    const install = path.join(
      yield* temporaryDirectory("fleetfrog-t3server-"),
      "runtime",
      "versions",
      version,
    );

    const executable = path.join(install, "t3-sleep");

    mkdirSync(install, { recursive: true });
    copyFileSync("/bin/sleep", executable);

    if (process.platform === "darwin") {
      execFileSync("codesign", ["--force", "--sign", "-", executable], { stdio: "pipe" });
    }

    const server = yield* Effect.acquireRelease(
      Effect.sync(() => spawn(executable, ["600"], { stdio: "ignore" })),
      (child) => Effect.sync(() => child.kill()),
    );

    return server.pid ?? 0;
  });
}

export function writeT3CodeRuntime(
  userdata: string,
  runtime: {
    readonly pid: number;
    readonly port?: number | undefined;
    readonly serviceManaged?: boolean | string | undefined;
  },
) {
  writeFileSync(
    path.join(userdata, "server-runtime.json"),
    JSON.stringify({
      version: 1,
      pid: runtime.pid,
      port: runtime.port ?? 3773,
      startedAt: "2026-10-13T00:00:00.000Z",
      serviceManaged: runtime.serviceManaged,
    }),
  );
}

export function runningT3CodeServer(
  userdata: string,
  serviceManaged?: boolean | string,
  options: { readonly port?: number; readonly version?: string } = {},
) {
  return startT3CodeProcess(options.version).pipe(
    Effect.tap((pid) =>
      Effect.sync(() => writeT3CodeRuntime(userdata, { pid, port: options.port, serviceManaged })),
    ),
  );
}
