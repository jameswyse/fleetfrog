import { createHash } from "node:crypto";

import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

import type { ProjectIconFile } from "@fleetfrog/protocol/agent/rpcs";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ media_type: Schema.String, data: Schema.Uint8Array })),
);

/** The image types a project icon may be, as agents look for them. */
const imageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
]);

/** The largest icon an agent sends. */
const maximumIconBytes = 256 * 1024;

/**
 * The icon's bytes, or null for one the hub won't serve: an unknown type, too large, or bytes that
 * don't match the hash it's named by. Browsers keep each icon for good under its hash, so the name
 * must be the hash of what's served.
 */
function checkedBytes(icon: ProjectIconFile): Buffer | null {
  const data = Buffer.from(icon.base64, "base64");

  return imageTypes.has(icon.mediaType) &&
    data.length > 0 &&
    data.length <= maximumIconBytes &&
    createHash("sha256").update(data).digest("hex") === icon.id
    ? data
    : null;
}

/** The images machines last reported as project icons, each named by a hash of its bytes. */
export class ProjectIconStore extends Context.Service<
  ProjectIconStore,
  {
    /** Replaces every icon a machine holds. */
    readonly replace: (report: {
      readonly machineId: MachineId;
      readonly icons: ReadonlyArray<ProjectIconFile>;
    }) => Effect.Effect<void>;
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<{ readonly mediaType: string; readonly data: Uint8Array }>>;
  }
>()("fleetfrog/ProjectIconStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      return {
        replace: Effect.fn("ProjectIconStore.replace")(
          function* ({ machineId, icons }) {
            yield* sql`delete from project_icons where machine_id = ${machineId}`;

            for (const icon of icons) {
              const data = checkedBytes(icon);

              if (data === null) {
                yield* Effect.logWarning("Ignored a project icon that doesn't check out").pipe(
                  Effect.annotateLogs({ machineId, icon: icon.id, mediaType: icon.mediaType }),
                );
              } else {
                yield* sql`insert into project_icons ${sql.insert({
                  machine_id: machineId,
                  id: icon.id,
                  media_type: icon.mediaType,
                  data,
                })} on conflict do nothing`;
              }
            }
          },
          sql.withTransaction,
          Effect.orDie,
        ),
        find: (id) =>
          // A machine removed while its report was on the way may leave icons behind.
          sql`select media_type, data from project_icons
              where id = ${id} and machine_id in (select id from machines) limit 1`.pipe(
            Effect.flatMap(decodeRows),
            Effect.map(([row]) =>
              Option.map(Option.fromNullishOr(row), ({ media_type, data }) => ({
                mediaType: media_type,
                data,
              })),
            ),
            Effect.orDie,
          ),
      };
    }),
  );
}
