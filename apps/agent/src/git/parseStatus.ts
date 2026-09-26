import { Schema } from "effect";

import { FileState } from "@fleetfrog/protocol/domain/checkout";

import type { ChangedFile, Head } from "@fleetfrog/protocol/domain/checkout";

/** Lists sent to the hub stop here; totals still count everything. */
export const listLimit = 200;

export interface ParsedStatus {
  readonly head: Head;
  /** The checked-out commit, absent on an unborn branch. */
  readonly commit: string | null;
  readonly changed: { readonly items: ReadonlyArray<ChangedFile>; readonly total: number };
  readonly untracked: { readonly items: ReadonlyArray<string>; readonly total: number };
  readonly stashCount: number;
}

const isFileState = Schema.is(FileState);

function fileState(code: string | undefined): FileState {
  return code !== undefined && isFileState(code) ? code : ".";
}

/** Ordinary, renamed or copied, and unmerged entries have 8, 9 and 10 fields before the path. */
function fieldsBeforePath(kind: string | undefined): number {
  if (kind === "1") {
    return 8;
  }

  if (kind === "2") {
    return 9;
  }

  return 10;
}

function headFrom(parts: {
  readonly branch: string | null;
  readonly commit: string | null;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
}): Head {
  if (parts.branch === null) {
    return { _tag: "Detached" };
  }

  if (parts.commit === null) {
    return { _tag: "Unborn", name: parts.branch };
  }

  return {
    _tag: "Branch",
    name: parts.branch,
    upstream:
      parts.upstream === null
        ? null
        : {
            name: parts.upstream,
            ahead: parts.ahead ?? 0,
            behind: parts.behind ?? 0,
            // Git omits the ahead/behind header when the upstream ref no longer exists.
            gone: parts.ahead === null,
          },
  };
}

/**
 * Parses `git status --porcelain=v2 --branch --show-stash -z`.
 * See the "Porcelain Format Version 2" section of git-status(1).
 */
export function parseStatus(output: string): ParsedStatus {
  const records = output.split("\0");
  let commit: string | null = null;
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let stashCount = 0;
  const changed: Array<ChangedFile> = [];
  let changedTotal = 0;
  const untracked: Array<string> = [];
  let untrackedTotal = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";

    if (record.startsWith("# ")) {
      const [, key, ...rest] = record.split(" ");
      const value = rest.join(" ");

      if (key === "branch.oid") {
        commit = value === "(initial)" ? null : value;
      } else if (key === "branch.head") {
        branch = value === "(detached)" ? null : value;
      } else if (key === "branch.upstream") {
        upstream = value;
      } else if (key === "branch.ab") {
        const [aheadText, behindText] = rest;

        ahead = Number(aheadText?.slice(1));
        behind = Number(behindText?.slice(1));
      } else if (key === "stash") {
        stashCount = Number(value);
      }
    } else if (record.startsWith("? ")) {
      untrackedTotal += 1;

      if (untracked.length < listLimit) {
        untracked.push(record.slice(2));
      }
    } else if (record.startsWith("1 ") || record.startsWith("2 ") || record.startsWith("u ")) {
      const kind = record[0];
      const fields = record.split(" ");
      const path = fields.slice(fieldsBeforePath(kind)).join(" ");
      const states = fields[1] ?? "..";
      // A rename's original path is the next NUL-separated record.
      const originalPath = kind === "2" ? (records[index + 1] ?? null) : null;

      if (kind === "2") {
        index += 1;
      }

      changedTotal += 1;

      if (changed.length < listLimit) {
        changed.push({
          path,
          originalPath,
          staged: fileState(states[0]),
          unstaged: fileState(states[1]),
        });
      }
    }
  }

  return {
    head: headFrom({ branch, commit, upstream, ahead, behind }),
    commit,
    changed: { items: changed, total: changedTotal },
    untracked: { items: untracked, total: untrackedTotal },
    stashCount,
  };
}
