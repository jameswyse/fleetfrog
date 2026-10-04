import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { Placement } from "@fleetfrog/protocol/domain/checkout";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const ArchiveRecord = Schema.Struct({
  originalPath: Schema.String,
  archivedAt: Schema.DateTimeUtcFromString,
  worktrees: Schema.Array(
    Schema.Struct({ originalPath: Schema.String, archivedPath: Schema.String }),
  ).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
});
type ArchiveRecord = typeof ArchiveRecord.Type;

const RecordJson = Schema.fromJsonString(ArchiveRecord);
const decodeRecord = Schema.decodeUnknownOption(RecordJson);
const encodeRecord = Schema.encodeSync(RecordJson);

function recordPath(commonDirectory: string): string {
  return path.join(commonDirectory, "fleetfrog-archive.json");
}

export const writeArchiveRecord = (commonDirectory: string, record: ArchiveRecord) =>
  Effect.promise(() =>
    writeFile(recordPath(commonDirectory), `${encodeRecord(record)}\n`).then(
      () => null,
      (error: unknown) => `Couldn't record where the checkout came from: ${String(error)}`,
    ),
  );

export const removeArchiveRecord = (commonDirectory: string) =>
  Effect.promise(() => rm(recordPath(commonDirectory), { force: true }).catch(() => undefined));

export const readArchiveRecord = (commonDirectory: string) =>
  Effect.promise(() => readFile(recordPath(commonDirectory), "utf8").catch(() => "")).pipe(
    Effect.map(decodeRecord),
  );

export const archivedPlacement = (
  location: Pick<CheckoutLocation, "path" | "commonDirectory" | "worktree">,
) =>
  readArchiveRecord(location.commonDirectory).pipe(
    Effect.map((record) =>
      Option.match(record, {
        onNone: () => Placement.cases.Archive.make({ originalPath: null, archivedAt: null }),
        onSome: ({ originalPath, archivedAt, worktrees }) =>
          Placement.cases.Archive.make({
            originalPath:
              location.worktree._tag === "Main"
                ? originalPath
                : (worktrees.find(({ archivedPath }) => archivedPath === location.path)
                    ?.originalPath ?? null),
            archivedAt,
          }),
      }),
    ),
  );
