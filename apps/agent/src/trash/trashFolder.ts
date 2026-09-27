import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

import type { TrashId } from "@fleetfrog/protocol/domain/trash";

/**
 * Where this machine keeps trashed checkouts: application data in the home directory, which is
 * normally on the same disk as the projects, so moving a checkout there is a rename.
 */
export function defaultTrashDirectory(): string {
  return process.platform === "darwin"
    ? path.join(homedir(), "Library", "Application Support", "FleetFrog", "Trash")
    : path.join(
        process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
        "fleetfrog",
        "trash",
      );
}

const ItemJson = Schema.fromJsonString(Schema.toCodecJson(TrashedCheckout));
const decodeItem = Schema.decodeUnknownOption(ItemJson);
const encodeItem = Schema.encodeSync(ItemJson);

/** The folder holding one trashed checkout: its record and, inside it, the checkout itself. */
export function itemDirectory(trash: string, id: TrashId): string {
  return path.join(trash, id);
}

export function itemCheckoutPath(trash: string, id: TrashId): string {
  return path.join(itemDirectory(trash, id), "checkout");
}

function itemRecordPath(trash: string, id: TrashId): string {
  return path.join(itemDirectory(trash, id), "item.json");
}

/** Creates the item's folder and saves its record, returning why that failed, or null. */
export const writeTrashItem = (trash: string, item: TrashedCheckout) =>
  Effect.promise(async () => {
    try {
      await mkdir(itemDirectory(trash, item.id), { recursive: true, mode: 0o700 });
      await writeFile(itemRecordPath(trash, item.id), `${encodeItem(item)}\n`);

      return null;
    } catch (error) {
      return `Couldn't prepare the trash: ${String(error)}`;
    }
  });

/** The item's record, or none when it isn't in the trash. */
export const readTrashItem = (trash: string, id: TrashId) =>
  Effect.promise(() =>
    readFile(itemRecordPath(trash, id), "utf8").then(decodeItem, () => Option.none()),
  );

/** Removes the item's folder and everything in it. */
export const removeTrashItem = (trash: string, id: TrashId) =>
  Effect.promise(() =>
    rm(itemDirectory(trash, id), { recursive: true, force: true }).then(
      () => null,
      (error: unknown) => `Couldn't remove it from the trash: ${String(error)}`,
    ),
  );

/** Everything in the trash, newest first. Folders without a readable record are left out. */
export const listTrash = (trash: string) =>
  Effect.promise(async () => {
    const names = await readdir(trash).catch(() => []);
    const items = await Promise.all(
      names.map((name) =>
        readFile(path.join(trash, name, "item.json"), "utf8").then(decodeItem, () => Option.none()),
      ),
    );

    return items
      .flatMap((item) => (Option.isSome(item) ? [item.value] : []))
      .toSorted(
        (left, right) => right.trashedAt.epochMilliseconds - left.trashedAt.epochMilliseconds,
      );
  });
