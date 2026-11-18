import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Stream } from "effect";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { MachineStore } from "../machines/machineStore.ts";
import { AgentSessions } from "./agentSessions.ts";
import { TestAgentSessions } from "./testAgentSessions.ts";

const studio = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");

const connectStudio = Effect.gen(function* () {
  const machines = yield* MachineStore;
  const sessions = yield* AgentSessions;

  yield* machines.create({
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
  });

  return yield* sessions.connect({
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
  });
});

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
});
