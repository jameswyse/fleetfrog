import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { ProjectLayoutChanged } from "@fleetfrog/protocol/dashboard/rpcs";
import { defaultPollingSettings, PollingSettings } from "@fleetfrog/protocol/domain/polling";
import { ProjectLayout, unsavedProjectLayout } from "@fleetfrog/protocol/domain/projectLayout";

import { JsonColumn } from "../persistence/database.ts";

import type { SavedProjectLayout } from "@fleetfrog/protocol/domain/projectLayout";
import type { UserId } from "@fleetfrog/protocol/domain/user";

const LayoutJson = JsonColumn(ProjectLayout);
const encodeLayout = Schema.encodeSync(LayoutJson);
const encodePolling = Schema.encodeSync(JsonColumn(PollingSettings));

const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ layout: Schema.NullOr(LayoutJson), revision: Schema.Int })),
);

export class ProjectLayoutStore extends Context.Service<
  ProjectLayoutStore,
  {
    readonly get: (userId: UserId | null) => Effect.Effect<SavedProjectLayout>;
    readonly save: (
      userId: UserId | null,
      layout: ProjectLayout,
      revision: number,
    ) => Effect.Effect<number, ProjectLayoutChanged>;
  }
>()("fleetfrog/ProjectLayoutStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const get = (userId: UserId | null) =>
        (userId === null
          ? sql`select open_project_layout_json as layout, open_project_layout_revision as revision from settings where id = 1`
          : sql`select project_layout_json as layout, project_layout_revision as revision from users where id = ${userId}`
        ).pipe(
          Effect.flatMap(decodeRows),
          Effect.map(([row]): SavedProjectLayout => ({
            layout: row?.layout ?? unsavedProjectLayout.layout,
            revision: row?.revision ?? unsavedProjectLayout.revision,
          })),
          Effect.orDie,
        );

      const write = (userId: UserId | null, layout: ProjectLayout, revision: number) =>
        (userId === null
          ? sql`insert into settings ${sql.insert({
              id: 1,
              polling_json: encodePolling(defaultPollingSettings),
              open_project_layout_json: encodeLayout(layout),
              open_project_layout_revision: revision,
            })} on conflict (id) do update set open_project_layout_json = excluded.open_project_layout_json, open_project_layout_revision = excluded.open_project_layout_revision`
          : sql`update users set project_layout_json = ${encodeLayout(layout)}, project_layout_revision = ${revision} where id = ${userId}`
        ).pipe(Effect.orDie, Effect.asVoid);

      return {
        get,
        save: (userId, layout, revision) =>
          Effect.gen(function* () {
            const current = yield* get(userId);

            if (current.revision !== revision) {
              return yield* new ProjectLayoutChanged({ current });
            }

            yield* write(userId, layout, revision + 1);

            return revision + 1;
          }).pipe(sql.withTransaction, Effect.catchTag("SqlError", Effect.die)),
      };
    }),
  );
}
