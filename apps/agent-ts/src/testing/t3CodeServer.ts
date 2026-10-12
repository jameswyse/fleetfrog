import { spawn } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import { temporaryDirectory } from "./temporaryDirectory.ts";

export function runningT3CodeServer(userdata: string, serviceManaged?: boolean | string) {
  return Effect.gen(function* () {
    const install = yield* temporaryDirectory("fleetfrog-t3server-");
    const executable = path.join(install, "t3-sleep");

    copyFileSync("/bin/sleep", executable);

    const server = yield* Effect.acquireRelease(
      Effect.sync(() => spawn(executable, ["600"], { stdio: "ignore" })),
      (child) => Effect.sync(() => child.kill()),
    );

    writeFileSync(
      path.join(userdata, "server-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: server.pid,
        port: 3773,
        startedAt: "2026-10-13T00:00:00.000Z",
        serviceManaged,
      }),
    );
  });
}
