import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

import { dataHome } from "../config/environment.ts";

import type { TrashId } from "@fleetfrog/protocol/domain/trash";

export function defaultTrashDirectory(): string {
  return process.platform === "darwin"
    ? path.join(homedir(), "Library", "Application Support", "FleetFrog", "Trash")
    : path.join(dataHome(), "fleetfrog", "trash");
}

const ItemJson = Schema.fromJsonString(Schema.toCodecJson(TrashedCheckout));
const decodeItem = Schema.decodeUnknownOption(ItemJson);
const encodeItem = Schema.encodeSync(ItemJson);

function itemDirectory(trash: string, id: TrashId): string {
  return path.join(trash, id);
}

export function itemCheckoutPath(trash: string, id: TrashId): string {
  return path.join(itemDirectory(trash, id), "checkout");
}

export function itemWorktreePath(trash: string, id: TrashId, name: string): string {
  return path.join(itemDirectory(trash, id), "worktrees", name);
}

function itemRecordPath(trash: string, id: TrashId): string {
  return path.join(itemDirectory(trash, id), "item.json");
}

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

export const readTrashItem = (trash: string, id: TrashId) =>
  Effect.promise(() =>
    readFile(itemRecordPath(trash, id), "utf8").then(decodeItem, () => Option.none()),
  );

export const removeTrashItem = (trash: string, id: TrashId) =>
  Effect.promise(() =>
    rm(itemDirectory(trash, id), { recursive: true, force: true }).then(
      () => null,
      (error: unknown) => `Couldn't remove it from the trash: ${String(error)}`,
    ),
  );

export const forgetTrashItem = (trash: string, id: TrashId) =>
  Effect.promise(async () => {
    await rm(itemRecordPath(trash, id), { force: true }).catch(() => undefined);
    await rmdir(path.join(itemDirectory(trash, id), "worktrees")).catch(() => undefined);
    await rmdir(itemDirectory(trash, id)).catch(() => undefined);
  });

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
