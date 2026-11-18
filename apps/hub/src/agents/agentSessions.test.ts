import { describe, expect, it } from "@effect/vitest";
import { DateTime, Deferred, Effect, Exit, Fiber, Scope, Stream, SubscriptionRef } from "effect";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { MachineStore } from "../machines/machineStore.ts";
import { AgentSessions } from "./agentSessions.ts";
import { TestAgentSessions } from "./testAgentSessions.ts";

const studio = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");

const pairStudio = MachineStore.use((machines) =>
  machines.create({
    id: studio,
    tokenHash: "hash",
    info: {
      hostname: "studio",
      prettyName: null,
      platform: "darwin",
      homeDirectory: "/Users/dev",
      agentVersion: "0.0.1",
      agentRuntime: "rust",
      githubCli: { _tag: "Unavailable", reason: "" },
      system: null,
    },
    discoveryRoots: [],
    pairedAt: DateTime.makeUnsafe("2026-09-26T00:00:00.000Z"),
  }),
);

const connectPairedStudio = AgentSessions.use((sessions) =>
  sessions.connect({
    machineId: studio,
    capabilities: {
      actions: [],
      allowedTiers: [],
      policyReadable: true,
      createsFolders: true,
      updatesItself: false,
      updatesT3Code: false,
      updatesT3CodeApp: false,
    },
  }),
);

const connectStudio = pairStudio.pipe(Effect.andThen(connectPairedStudio));

const onlineSession = AgentSessions.use(({ online }) =>
  SubscriptionRef.get(online).pipe(Effect.map((agents) => agents.get(studio)?.sessionId)),
);

describe("AgentSessions", () => {
  it.effect("configures a connected agent again only when its configuration changes", () =>
    Effect.gen(function* () {
      const machines = yield* MachineStore;
      const sessions = yield* AgentSessions;
      const commands = yield* connectStudio;

      yield* sessions.reconfigure(studio);
      yield* sessions.reconfigure(studio);
      yield* machines.setDiscoveryRoots({ machineId: studio, roots: ["~/Projects"] });
      yield* sessions.reconfigure(studio);
      yield* sessions.disconnect(studio);

      const sent = yield* Stream.runCollect(commands);

      expect(
        sent.map((command) => (command._tag === "Configure" ? command.discoveryRoots : command)),
      ).toStrictEqual([[], ["~/Projects"]]);
    }).pipe(Effect.scoped, Effect.provide(TestAgentSessions)),
  );

  it.effect("replaces a connection without showing the agent offline in between", () =>
    Effect.gen(function* () {
      const sessions = yield* AgentSessions;
      const firstScope = yield* Scope.fork(yield* Scope.Scope);
      const subscribed = yield* Deferred.make<void>();

      const shown = yield* SubscriptionRef.changes(sessions.online).pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.map((agents) => agents.get(studio)?.sessionId ?? "offline"),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* Deferred.await(subscribed);
      yield* pairStudio;

      const first = yield* connectPairedStudio.pipe(Scope.provide(firstScope));
      const original = yield* onlineSession;
      const second = yield* connectPairedStudio;
      const replacement = yield* onlineSession;

      expect(yield* Fiber.join(shown)).toStrictEqual(["offline", original, replacement]);
      expect(replacement).not.toBe(original);

      expect((yield* Stream.runCollect(first)).map(({ _tag }) => _tag)).toStrictEqual([
        "Configure",
      ]);

      yield* Scope.close(firstScope, Exit.void);

      expect(yield* onlineSession).toBe(replacement);

      yield* sessions.refresh([studio]);
      yield* sessions.disconnect(studio);

      expect((yield* Stream.runCollect(second)).map(({ _tag }) => _tag)).toStrictEqual([
        "Configure",
        "Refresh",
      ]);
    }).pipe(Effect.scoped, Effect.provide(TestAgentSessions)),
  );
});
