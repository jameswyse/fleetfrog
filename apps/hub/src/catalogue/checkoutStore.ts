import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { Checkout } from "@fleetfrog/protocol/domain/checkout";
import { MachineCheckout } from "@fleetfrog/protocol/domain/fleet";

import { JsonColumn } from "../persistence/database.ts";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

const CheckoutJson = JsonColumn(Checkout);
const encodeCheckout = Schema.encodeSync(CheckoutJson);
const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({ machine_id: MachineCheckout.fields.machineId, checkout_json: CheckoutJson }),
  ),
);

/** The last observed checkouts for every machine. Replaceable at any time by a fresh scan. */
export class CheckoutStore extends Context.Service<
  CheckoutStore,
  {
    readonly all: Effect.Effect<ReadonlyArray<MachineCheckout>>;
    /** Replaces a machine's whole inventory after a completed discovery walk. */
    readonly replace: (inventory: {
      readonly machineId: MachineId;
      readonly checkouts: ReadonlyArray<Checkout>;
    }) => Effect.Effect<void>;
    /** Upserts changed checkouts and drops removed ones after a status pass. */
    readonly apply: (changes: {
      readonly machineId: MachineId;
      readonly changed: ReadonlyArray<Checkout>;
      readonly removedPaths: ReadonlyArray<string>;
    }) => Effect.Effect<void>;
  }
>()("fleetfrog/CheckoutStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const upsert = (machineId: MachineId, checkouts: ReadonlyArray<Checkout>) =>
        Effect.forEach(
          checkouts,
          (checkout) =>
            sql`insert into checkouts ${sql.insert({
              machine_id: machineId,
              path: checkout.path,
              checkout_json: encodeCheckout(checkout),
            })} on conflict (machine_id, path) do update set checkout_json = excluded.checkout_json`,
          { discard: true },
        );

      return {
        all: sql`select machine_id, checkout_json from checkouts order by machine_id, path`.pipe(
          Effect.flatMap(decodeRows),
          Effect.map((rows) =>
            rows.map((row) => ({ machineId: row.machine_id, checkout: row.checkout_json })),
          ),
          Effect.orDie,
        ),
        replace: Effect.fn("CheckoutStore.replace")(
          function* ({ machineId, checkouts }) {
            yield* sql`delete from checkouts where machine_id = ${machineId}`;
            yield* upsert(machineId, checkouts);
          },
          sql.withTransaction,
          Effect.orDie,
        ),
        apply: Effect.fn("CheckoutStore.apply")(
          function* ({ machineId, changed, removedPaths }) {
            if (removedPaths.length > 0) {
              yield* sql`delete from checkouts where machine_id = ${machineId} and ${sql.in("path", removedPaths)}`;
            }

            yield* upsert(machineId, changed);
          },
          sql.withTransaction,
          Effect.orDie,
        ),
      };
    }),
  );
}
