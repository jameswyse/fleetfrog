import { randomUUID } from "node:crypto";

import { DateTime, Duration, Effect, Layer, PubSub, Random } from "effect";
import { RpcTest } from "effect/rpc";

import { AgentRpcs } from "@fleetfrog/protocol/agent/rpcs";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { ProjectGroupId } from "@fleetfrog/protocol/domain/projectLayout";

import { AgentAuthenticationLive } from "../agents/agentAuthentication.ts";
import { AgentHandlers } from "../agents/agentHandlers.ts";
import { AgentUpdates } from "../agents/agentUpdates.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { issueAgentToken } from "../pairing/agentTokens.ts";
import { ProjectLayoutStore } from "../settings/projectLayoutStore.ts";
import { demoLayout, demoMachines, demoRepositories } from "./demoFleetData.ts";
import { seedHistory } from "./demoHistory.ts";
import { liven } from "./demoLife.ts";
import { buildWorld, machineInfo } from "./demoWorld.ts";
import { runSimulatedAgent } from "./simulatedAgent.ts";

import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { DemoMachineKey } from "./demoFleetData.ts";
import type { DemoWorld } from "./demoWorld.ts";

const quietStart = Duration.seconds(90);

function repositoryKeys(world: DemoWorld, keys: ReadonlyArray<string>): Array<RepositoryKey> {
  return keys.flatMap((key) =>
    [...world.remotes.values()].flatMap((remote) => (remote.spec.key === key ? [remote.key] : [])),
  );
}

export const DemoFleet = Layer.effectDiscard(
  Effect.gen(function* () {
    const machines = yield* MachineStore;
    const layouts = yield* ProjectLayoutStore;
    const { targetVersion } = yield* AgentUpdates;
    const now = yield* DateTime.now;
    const world = buildWorld({ machines: demoMachines, repositories: demoRepositories, now });
    const client = yield* RpcTest.makeClient(AgentRpcs);
    const worldChanged = yield* PubSub.sliding<void>(1);

    yield* layouts
      .save(
        null,
        {
          sort: "name",
          groupByOwner: false,
          pinned: repositoryKeys(world, demoLayout.pinned),
          groups: demoLayout.groups.map((group) => ({
            id: ProjectGroupId.make(group.id),
            name: group.name,
            repositories: repositoryKeys(world, group.repositories),
          })),
          collapsed: [],
        },
        0,
      )
      .pipe(Effect.orDie);

    const machineIds = new Map<DemoMachineKey, MachineId>();

    for (const machine of world.machines) {
      const machineId = MachineId.make(randomUUID());

      machineIds.set(machine.spec.key, machineId);
      const { token, tokenHash } = issueAgentToken();

      yield* machines.create({
        id: machineId,
        tokenHash,
        info: machineInfo(machine.spec, now, targetVersion),
        discoveryRoots: [machine.spec.roots.projects, machine.spec.roots.work],
        pairedAt: DateTime.subtract(now, { days: machine.spec.pairedDaysAgo }),
      });
      yield* machines
        .setArchiveFolder({ machineId, folder: machine.spec.archive })
        .pipe(Effect.orDie);
      yield* runSimulatedAgent({
        client,
        token,
        world,
        machine,
        agentVersion: targetVersion,
        worldChanged,
      }).pipe(Effect.forkScoped);
    }

    yield* seedHistory({ world, machineIds });

    yield* Effect.gen(function* () {
      const delay = yield* Random.nextBetween(40, 80);

      yield* Effect.sleep(Duration.seconds(delay));
      yield* liven(world);
      yield* PubSub.publish(worldChanged, undefined);
    }).pipe(Effect.forever, Effect.delay(quietStart), Effect.forkScoped);

    yield* Effect.logInfo(
      "Demo mode: the dashboard shows simulated machines, and nothing is saved when the hub stops",
    );
  }),
).pipe(Layer.provide([AgentHandlers, AgentAuthenticationLive]));
