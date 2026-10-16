import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Option, Schedule } from "effect";

import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { runProgram } from "./runTool.ts";

const touchLater = (marker: string, timeout: Duration.Duration) =>
  runProgram({
    executable: "/bin/sh",
    args: ["-c", `sleep 1; touch "$0"`, marker],
    timeout,
  });

describe("runProgram", () => {
  it.live("leaves the program running when nobody waits for it", () =>
    Effect.gen(function* () {
      const marker = path.join(yield* temporaryDirectory("fleetfrog-program-"), "finished");

      yield* touchLater(marker, Duration.seconds(10)).pipe(
        Effect.timeoutOption(Duration.millis(100)),
      );

      const touched = yield* Effect.sync(() => existsSync(marker)).pipe(
        Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("50 millis") }),
        Effect.timeoutOption(Duration.seconds(10)),
      );

      expect(touched).toStrictEqual(Option.some(true));
    }),
  );

  it.live("stops a program that runs past its timeout", () =>
    Effect.gen(function* () {
      const marker = path.join(yield* temporaryDirectory("fleetfrog-program-"), "finished");
      const result = yield* touchLater(marker, Duration.millis(100));

      // oxlint-disable-next-line wyse/no-fixed-test-delay -- proving the stopped program never touches the marker needs a wait past the moment it would have
      yield* Effect.sleep(Duration.millis(1500));

      expect(result._tag).toBe("TimedOut");
      expect(existsSync(marker)).toBe(false);
    }),
  );

  it.live("kills a program that ignores the request to stop", () =>
    Effect.gen(function* () {
      const result = yield* runProgram({
        executable: "/bin/sh",
        args: ["-c", "trap '' TERM; sleep 30"],
        timeout: Duration.millis(100),
        stopGrace: Duration.millis(300),
      }).pipe(Effect.timeoutOption(Duration.seconds(3)));

      expect(result).toStrictEqual(Option.some({ _tag: "TimedOut", output: "" }));
    }),
  );

  it.live("stops a descendant that outlives the program before giving up on it", () =>
    Effect.gen(function* () {
      const pidFile = path.join(yield* temporaryDirectory("fleetfrog-program-"), "group");

      const result = yield* runProgram({
        executable: "/bin/sh",
        args: ["-c", `echo $$ > "$0"; sh -c "trap '' TERM; sleep 30" & wait`, pidFile],
        timeout: Duration.millis(300),
        stopGrace: Duration.millis(300),
      });

      const group = Number(readFileSync(pidFile, "utf8"));

      expect(result._tag).toBe("TimedOut");
      expect(() => process.kill(-group, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    }),
  );

  it.live("collects the program's output and exit code", () =>
    Effect.gen(function* () {
      expect(
        yield* runProgram({
          executable: "/bin/sh",
          args: ["-c", "echo first >&2; sleep 0.2; echo second; exit 3"],
          timeout: Duration.seconds(10),
        }),
      ).toStrictEqual({ _tag: "Exited", code: 3, signal: null, output: "first\nsecond\n" });
    }),
  );

  it.live("finishes when the program leaves a process holding its output", () =>
    Effect.gen(function* () {
      const result = yield* runProgram({
        executable: "/bin/sh",
        args: ["-c", "sleep 5 & echo started"],
        timeout: Duration.seconds(10),
      }).pipe(Effect.timeoutOption(Duration.seconds(3)));

      expect(result).toStrictEqual(
        Option.some({ _tag: "Exited", code: 0, signal: null, output: "started\n" }),
      );
    }),
  );
});
