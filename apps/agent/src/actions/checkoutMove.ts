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

/** A folder to move, and where to. */
export interface Move {
  readonly from: string;
  readonly to: string;
}

/**
 * Where a main checkout and its linked worktrees go. Worktrees inside the checkout's folder travel
 * with it, the others move on their own or stay where they are, and all of them are relinked.
 */
export interface CheckoutMove {
  readonly main: Move;
  /** Worktrees inside the main checkout's folder, and where they end up with it. */
  readonly nested: ReadonlyArray<Move>;
  /** Worktrees elsewhere that move on their own. */
  readonly separate: ReadonlyArray<Move>;
  /** Worktrees that stay where they are, which still need relinking. */
  readonly staying: ReadonlyArray<string>;
}

/**
 * Plans moving the main checkout to `destination`. `worktreeDestination` says where each linked
 * worktree outside it goes, or null to leave it. Returns a skip when something is already at a
 * destination, or when two destinations are the same or one is inside another.
 */
export const planCheckoutMove = Effect.fn("planCheckoutMove")(function* (options: {
  readonly location: Pick<CheckoutLocation, "path" | "commonDirectory">;
  readonly destination: string;
  readonly worktreeDestination: (worktree: string) => string | null;
}) {
  const { location, destination } = options;
  // A worktree whose folder is gone has nothing to move, and Git can prune it later.
  const linked = (yield* readLinkedWorktrees(location)).filter(({ state }) => state !== "Missing");
  const nested: Array<Move> = [];
  const separate: Array<Move> = [];
  const staying: Array<string> = [];

  for (const { path: worktree } of linked) {
    if (isWithin(worktree, location.path)) {
      nested.push({
        from: worktree,
        to: path.join(destination, path.relative(location.path, worktree)),
      });
    } else {
      const to = options.worktreeDestination(worktree);

      if (to === null) {
        staying.push(worktree);
      } else {
        separate.push({ from: worktree, to });
      }
    }
  }

  const targets = [destination, ...separate.map(({ to }) => to)];

  for (const [index, target] of targets.entries()) {
    const clash = targets.find(
      (other, otherIndex) => otherIndex !== index && isWithin(target, other),
    );

    if (clash !== undefined) {
      return {
        _tag: "Refused",
        outcome: skipped(SkipReason.cases.DestinationsClash.make({ path: clash })),
      } as const;
    }

    if (yield* exists(target)) {
      return {
        _tag: "Refused",
        outcome: skipped(SkipReason.cases.DestinationTaken.make({ path: target })),
      } as const;
    }
  }

  return {
    _tag: "Planned",
    move: { main: { from: location.path, to: destination }, nested, separate, staying },
  } as const;
});

/**
 * Moves the main checkout, then each separate worktree, then has Git relink every worktree from
 * the checkout's new place. A worktree that couldn't move is relinked where it is. Returns the
 * outcome when the main checkout couldn't move, or else the worktree moves that happened.
 */
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
