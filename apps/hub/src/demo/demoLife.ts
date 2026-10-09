import { DateTime, Effect, Random } from "effect";

import { digest, treesOf } from "./demoWorld.ts";

import type { DemoWorld, SimRemote, SimThread } from "./demoWorld.ts";

const maximumNewCommits = 4;
const fewestWorking = 2;
const mostWorking = 4;
const newCommitChance = 0.4;

function pick<A>(items: ReadonlyArray<A>) {
  return Random.shuffle(items).pipe(Effect.map(([first]) => first));
}

interface ThreadChange {
  readonly from: ReadonlyArray<SimThread>;
  readonly to: SimThread["state"];
}

function threadChange(threads: ReadonlyArray<SimThread>, roll: number): ThreadChange {
  const inState = (state: SimThread["state"]) => threads.filter((thread) => thread.state === state);
  const working = inState("Working");

  if (working.length < fewestWorking) {
    return { from: [...inState("Waiting"), ...inState("Idle")], to: "Working" };
  }

  if (working.length > mostWorking || roll >= 0.8) {
    return { from: working, to: "Idle" };
  }

  return roll < 0.6
    ? { from: working, to: "Waiting" }
    : { from: inState("Waiting"), to: "Working" };
}

function addCommit(remote: SimRemote, now: DateTime.Utc): void {
  const subject = remote.spec.history[remote.history.length % remote.spec.history.length];

  remote.history.push({
    sha: digest(remote.spec.key, "live", String(remote.history.length)),
    subject: subject ?? "Update dependencies",
    committedAt: now,
  });
}

export const liven = Effect.fnUntraced(function* (world: DemoWorld) {
  const now = yield* DateTime.now;
  const roll = yield* Random.next;

  const threads = world.machines.flatMap(({ repositories }) =>
    repositories.flatMap((repository) => treesOf(repository).flatMap((tree) => tree.threads)),
  );

  const working = threads.filter(({ state }) => state === "Working").length;

  if (working >= fewestWorking && working <= mostWorking && roll < newCommitChance) {
    const remote = yield* pick(
      [...world.remotes.values()].filter(
        ({ onGithub, history, initialLength }) =>
          onGithub && history.length < initialLength + maximumNewCommits,
      ),
    );

    if (remote !== undefined) {
      addCommit(remote, now);
    }

    return;
  }

  const change = threadChange(threads, roll);
  const thread = yield* pick(change.from);

  if (thread !== undefined) {
    thread.state = change.to;
    thread.updatedAt = now;
  }
});
