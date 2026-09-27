import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { Placement } from "@fleetfrog/protocol/domain/checkout";

import type { CheckoutLocation } from "../git/readCheckout.ts";

/**
 * Where FleetFrog moved an archived checkout from, kept in its Git directory so it travels with
 * the checkout and never shows up as a change.
 */
const ArchiveRecord = Schema.Struct({
  originalPath: Schema.String,
  archivedAt: Schema.DateTimeUtcFromString,
  /** The linked worktrees that moved with it. Absent from records that predate them. */
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

/** Saves the record, returning why it couldn't be saved, or null. */
export const writeArchiveRecord = (commonDirectory: string, record: ArchiveRecord) =>
  Effect.promise(() =>
    writeFile(recordPath(commonDirectory), `${encodeRecord(record)}\n`).then(
      () => null,
      (error: unknown) => `Couldn't record where the checkout came from: ${String(error)}`,
    ),
  );

/** Removes the record if there is one. A checkout without one is simply not archived. */
export const removeArchiveRecord = (commonDirectory: string) =>
  Effect.promise(() => rm(recordPath(commonDirectory), { force: true }).catch(() => undefined));

/** The checkout's record, or none for one put in the archive by hand. */
export const readArchiveRecord = (commonDirectory: string) =>
  Effect.promise(() => readFile(recordPath(commonDirectory), "utf8").catch(() => "")).pipe(
    Effect.map(decodeRecord),
  );

/** How an archived checkout came to be there. One put in the archive by hand has no record. */
export const archivedPlacement = (location: Pick<CheckoutLocation, "commonDirectory">) =>
  readArchiveRecord(location.commonDirectory).pipe(
    Effect.map((record) =>
      Option.match(record, {
        onNone: () => Placement.cases.Archive.make({ originalPath: null, archivedAt: null }),
        onSome: ({ originalPath, archivedAt }) =>
          Placement.cases.Archive.make({ originalPath, archivedAt }),
      }),
    ),
  );
