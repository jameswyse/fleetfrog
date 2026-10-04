import path from "node:path";

import { Effect } from "effect";

import { SkipReason } from "@fleetfrog/protocol/domain/action";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import { readLinkedWorktrees } from "../git/worktrees.ts";
import { runGitAction } from "../process/runTool.ts";
import { exists, moveFolder, unmoved } from "./movableCheckout.ts";
import { skipped } from "./outcomes.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

export interface Move {
  readonly from: string;
  readonly to: string;
}

export interface CheckoutMove {
  readonly main: Move;
  readonly nested: ReadonlyArray<Move>;
  readonly separate: ReadonlyArray<Move>;
  readonly staying: ReadonlyArray<string>;
}

function overlaps(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

const freePlace = Effect.fn("freePlace")(function* (target: string, chosen: ReadonlyArray<string>) {
  for (let number = 1; ; number += 1) {
    const candidate = number === 1 ? target : `${target}-${number}`;

    if (!chosen.some((other) => overlaps(candidate, other)) && !(yield* exists(candidate))) {
      return candidate;
    }
  }
});

export const planCheckoutMove = Effect.fn("planCheckoutMove")(function* (options: {
  readonly location: Pick<CheckoutLocation, "path" | "commonDirectory">;
  readonly destination: string;
  readonly worktreeDestination: (worktree: string) => string | null;
  readonly whenTaken: "Refuse" | "Number";
}) {
  const { location } = options;
  const linked = (yield* readLinkedWorktrees(location)).filter(({ state }) => state !== "Missing");
  const wanted: Array<Move> = [];
  const staying: Array<string> = [];

  for (const { path: worktree, state } of linked) {
    if (!isWithin(worktree, location.path)) {
      const to = state === "Present" ? options.worktreeDestination(worktree) : null;

      if (to === null) {
        staying.push(worktree);
      } else {
        wanted.push({ from: worktree, to });
      }
    }
  }

  const place = Effect.fnUntraced(function* (target: string, chosen: ReadonlyArray<string>) {
    if (options.whenTaken === "Number") {
      return { _tag: "Placed", path: yield* freePlace(target, chosen) } as const;
    }

    const clash = chosen.find((other) => overlaps(target, other));

    if (clash !== undefined) {
      return {
        _tag: "Refused",
        outcome: skipped(SkipReason.cases.DestinationsClash.make({ path: clash })),
      } as const;
    }

    return (yield* exists(target))
      ? ({
          _tag: "Refused",
          outcome: skipped(SkipReason.cases.DestinationTaken.make({ path: target })),
        } as const)
      : ({ _tag: "Placed", path: target } as const);
  });

  const main = yield* place(options.destination, []);

  if (main._tag === "Refused") {
    return main;
  }

  const destination = main.path;
  const chosen = [destination];
  const separate: Array<Move> = [];

  for (const { from, to } of wanted) {
    const placed = yield* place(to, chosen);

    if (placed._tag === "Refused") {
      return placed;
    }

    chosen.push(placed.path);
    separate.push({ from, to: placed.path });
  }

  const nested = linked
    .filter(({ path: worktree }) => isWithin(worktree, location.path))
    .map(({ path: worktree }) => ({
      from: worktree,
      to: path.join(destination, path.relative(location.path, worktree)),
    }));

  return {
    _tag: "Planned",
    move: { main: { from: location.path, to: destination }, nested, separate, staying },
  } as const;
});

export const performCheckoutMove = Effect.fn("performCheckoutMove")(function* (
  move: CheckoutMove,
  output: ActionOutput,
) {
  const notMoved = unmoved(yield* moveFolder(move.main), move.main.to);

  if (notMoved !== null) {
    return { _tag: "NotMoved", outcome: notMoved } as const;
  }

  output.write(`Moved ${move.main.from} to ${move.main.to}\n`);

  const moved: Array<Move> = [];
  const stayed: Array<string> = [...move.staying];

  for (const worktree of move.separate) {
    const result = yield* moveFolder(worktree);

    if (result._tag === "Moved") {
      moved.push(worktree);
      output.write(`Moved ${worktree.from} to ${worktree.to}\n`);
    } else {
      stayed.push(worktree.from);
      output.write(
        `Couldn't move the worktree at ${worktree.from}: ${result._tag === "Taken" ? `something is already at ${worktree.to}` : result.message}\n`,
      );
    }
  }

  const relinked = [...move.nested.map(({ to }) => to), ...moved.map(({ to }) => to), ...stayed];

  if (relinked.length > 0) {
    yield* runGitAction({
      cwd: move.main.to,
      args: ["worktree", "repair", ...relinked],
      onOutput: output.write,
    }).pipe(
      Effect.catchTag("CommandFailed", ({ message }) =>
        Effect.sync(() => output.write(`Couldn't relink the worktrees: ${message}\n`)),
      ),
    );
  }

  return { _tag: "Moved", worktrees: moved } as const;
});
