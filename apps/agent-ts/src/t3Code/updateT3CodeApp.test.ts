import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";

import { fakeT3CodeApp, installFakeT3CodeCli } from "../testing/fakeT3CodeApp.ts";
import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { updateT3CodeApp } from "./updateT3CodeApp.ts";

import type { FakeAppSocket } from "../testing/fakeT3CodeApp.ts";

const offered = [
  {
    _tag: "Chunk",
    requestId: "1",
    values: [
      {
        type: "complete",
        result: {
          targetVersion: "0.0.47",
          method: "desktop-app",
          desktopUpdateToken: "prepared-1",
        },
      },
    ],
  },
  { _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: null } },
];

const setUp = (options: {
  readonly onPrepare?: (socket: FakeAppSocket) => void;
  readonly stallHandshake?: boolean;
}) =>
  Effect.gen(function* () {
    const home = yield* temporaryDirectory("fleetfrog-t3app-update-");
    const calls = installFakeT3CodeCli(home);

    const app = yield* fakeT3CodeApp({
      onPrepare: options.onPrepare ?? (() => {}),
      stallHandshake: options.stallHandshake ?? false,
    });

    const revocations = () => calls().filter((call) => call.startsWith("auth session revoke"));

    const update = (recheck: Effect.Effect<void> = Effect.void) =>
      updateT3CodeApp({
        home,
        port: app.port,
        version: "0.0.47",
        recheck,
        connectTimeout: Duration.millis(200),
      });

    return { received: app.received, revocations, update };
  });

const tags = (received: ReadonlyArray<unknown>) =>
  received.flatMap((message) =>
    typeof message === "object" && message !== null && "tag" in message ? [message.tag] : [],
  );

describe("updateT3CodeApp", () => {
  it.live("fails when T3 Code's server closes the connection before the commit is sent", () =>
    Effect.gen(function* () {
      const test = yield* setUp({
        onPrepare: (socket) => {
          for (const message of offered) {
            socket.send(message);
          }

          socket.close();
        },
      });

      const error = yield* test.update(Effect.sleep(Duration.millis(300))).pipe(Effect.flip);

      expect(error.message).toBe(
        "T3 Code's server closed the connection before the update was ready.",
      );
      expect(tags(test.received)).toEqual(["server.updateServerWithProgress"]);
      expect(test.revocations()).toHaveLength(1);
    }),
  );

  it.live("stops waiting for a WebSocket handshake that never finishes", () =>
    Effect.gen(function* () {
      const test = yield* setUp({ stallHandshake: true });
      const error = yield* test.update().pipe(Effect.flip);

      expect(error.message).toBe(
        "Couldn't connect to T3 Code's server: it didn't answer within 30 seconds.",
      );
      expect(test.revocations()).toHaveLength(1);
    }),
  );

  it.live("revokes its session when it's interrupted while T3 Code prepares the update", () =>
    Effect.gen(function* () {
      const test = yield* setUp({});
      const running = yield* Effect.forkChild(test.update());

      yield* Effect.sleep(Duration.millis(50)).pipe(
        Effect.repeat({ until: () => tags(test.received).length > 0 }),
      );
      yield* Fiber.interrupt(running);

      expect(test.revocations()).toHaveLength(1);
    }),
  );
});
