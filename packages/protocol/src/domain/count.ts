import { Schema } from "effect";

/** A whole number of things, from zero up. */
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
