import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { checkPassword, hashPassword } from "./passwords.ts";

it.effect(
  "accepts only the password that was hashed",
  () =>
    Effect.gen(function* () {
      const hash = yield* hashPassword("correct horse");

      expect(hash).not.toContain("correct horse");
      expect(yield* checkPassword({ password: "correct horse", hash })).toBe(true);
      expect(yield* checkPassword({ password: "correct hors", hash })).toBe(false);
      expect(yield* checkPassword({ password: "correct horse", hash: null })).toBe(false);
    }),
  30_000,
);
