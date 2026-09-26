import { DateTime } from "effect";

import { listLimit } from "./parseStatus.ts";

import type { Commit, LocalBranch, Upstream } from "@fleetfrog/protocol/domain/checkout";

export const branchFormat = [
  "%(HEAD)",
  "%(refname:short)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(objectname)",
  "%(committerdate:iso-strict)",
  "%(contents:subject)",
].join("%00");

export interface ParsedBranches {
  readonly branches: { readonly items: ReadonlyArray<LocalBranch>; readonly total: number };
  /** The tip of the checked-out branch, absent when HEAD is detached or unborn. */
  readonly currentCommit: Commit | null;
}

const trackPart = /^(ahead|behind) (\d+)$/;

function upstreamFrom(name: string, track: string): Upstream | null {
  if (name === "") {
    return null;
  }

  const upstream = { name, ahead: 0, behind: 0, gone: track === "gone" };

  for (const part of track.split(", ")) {
    const match = trackPart.exec(part);

    if (match?.[1] === "ahead") {
      upstream.ahead = Number(match[2]);
    } else if (match?.[1] === "behind") {
      upstream.behind = Number(match[2]);
    }
  }

  return upstream;
}

/** Parses `git for-each-ref refs/heads --format=<branchFormat>`. */
export function parseBranches(output: string): ParsedBranches {
  const items: Array<LocalBranch> = [];
  let total = 0;
  let currentCommit: Commit | null = null;

  for (const line of output.split("\n")) {
    if (line === "") {
      continue;
    }

    const [marker, name = "", upstream = "", track = "", sha = "", committedAt = "", subject = ""] =
      line.split("\0");

    total += 1;

    if (items.length < listLimit) {
      items.push({ name, upstream: upstreamFrom(upstream, track) });
    }

    if (marker === "*") {
      currentCommit = {
        sha,
        subject,
        committedAt: DateTime.makeUnsafe(committedAt).pipe(DateTime.toUtc),
      };
    }
  }

  return { branches: { items, total }, currentCommit };
}
