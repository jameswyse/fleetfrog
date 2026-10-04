import { createHash } from "node:crypto";

import { SqliteClient } from "@effect/sql-sqlite-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { Migrations } from "../persistence/database.ts";
import { ProjectIconStore } from "./projectIconStore.ts";

const studio = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");
const svg = Buffer.from("<svg/>");
const svgId = createHash("sha256").update(svg).digest("hex");
const other = createHash("sha256").update("<svg>other</svg>").digest("hex");
const page = Buffer.from("<html></html>");
const pageId = createHash("sha256").update(page).digest("hex");

const TestStore = ProjectIconStore.layer.pipe(
  Layer.provideMerge(
    Migrations.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" }))),
  ),
);

const pairStudio = SqlClient.SqlClient.use(
  (sql) =>
    sql`insert into machines ${sql.insert({
      id: studio,
      token_hash: "hash",
      info_json: "{}",
      discovery_roots_json: "[]",
      paired_at: "2026-09-26T00:00:00.000Z",
    })}`,
);

it.effect("serves only icons whose bytes match their hash and whose type is an image", () =>
  Effect.gen(function* () {
    const store = yield* ProjectIconStore;

    yield* pairStudio;
    yield* store.replace({
      machineId: studio,
      icons: [
        { id: svgId, mediaType: "image/svg+xml", base64: svg.toString("base64") },
        { id: other, mediaType: "image/svg+xml", base64: svg.toString("base64") },
        { id: pageId, mediaType: "text/html", base64: page.toString("base64") },
      ],
    });

    const found = yield* store.find(svgId);

    expect(
      Option.map(found, ({ mediaType, data }) => [mediaType, Buffer.from(data).toString()]),
    ).toEqual(Option.some(["image/svg+xml", "<svg/>"]));
    expect(Option.isNone(yield* store.find(other))).toBe(true);
    expect(Option.isNone(yield* store.find(pageId))).toBe(true);
  }).pipe(Effect.provide(TestStore)),
);

it.effect("stops serving a removed machine's icons", () =>
  Effect.gen(function* () {
    const store = yield* ProjectIconStore;
    const sql = yield* SqlClient.SqlClient;

    yield* pairStudio;
    yield* store.replace({
      machineId: studio,
      icons: [{ id: svgId, mediaType: "image/svg+xml", base64: svg.toString("base64") }],
    });
    yield* sql`delete from machines where id = ${studio}`;

    expect(Option.isNone(yield* store.find(svgId))).toBe(true);
  }).pipe(Effect.provide(TestStore)),
);
