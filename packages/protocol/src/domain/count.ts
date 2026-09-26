import { Schema } from "effect";

export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
