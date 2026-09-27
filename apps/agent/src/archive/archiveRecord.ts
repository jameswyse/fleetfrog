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

/** How an archived checkout came to be there. One put in the archive by hand has no record. */
export const archivedPlacement = (location: Pick<CheckoutLocation, "commonDirectory">) =>
  Effect.promise(() => readFile(recordPath(location.commonDirectory), "utf8").catch(() => "")).pipe(
    Effect.map((text) =>
      Option.match(decodeRecord(text), {
        onNone: () => Placement.cases.Archive.make({ originalPath: null, archivedAt: null }),
        onSome: (record) => Placement.cases.Archive.make(record),
      }),
    ),
  );
