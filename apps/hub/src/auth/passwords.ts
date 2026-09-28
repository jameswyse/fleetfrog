import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { Effect } from "effect";

/** scrypt at the cost OWASP recommends. 128 × N × r bytes is exactly 32 MiB, Node's default limit. */
const cost = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const keyLength = 32;

function derive(
  password: string,
  salt: Buffer,
  { N, r, p }: { readonly N: number; readonly r: number; readonly p: number },
): Effect.Effect<Buffer> {
  return Effect.callback<Buffer>((resume) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: cost.maxmem }, (error, key) =>
      resume(error === null ? Effect.succeed(key) : Effect.die(error)),
    );
  });
}

/** Hashes a password as `scrypt$N$r$p$salt$key`, so a later cost change can still check it. */
export const hashPassword = Effect.fnUntraced(function* (password: string) {
  const salt = randomBytes(16);
  const key = yield* derive(password, salt, cost);

  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64"), key.toString("base64")].join(
    "$",
  );
});

const Stored = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

/** Checked against when there's no user, so a wrong email takes as long as a wrong password. */
let placeholderHash: string | null = null;

/** Whether the password matches the stored hash. With no hash, it takes as long and fails. */
export const checkPassword = Effect.fnUntraced(function* (check: {
  readonly password: string;
  readonly hash: string | null;
}) {
  placeholderHash ??= yield* hashPassword("placeholder");

  const match = Stored.exec(check.hash ?? placeholderHash);

  if (match === null) {
    return false;
  }

  const [, N = "", r = "", p = "", salt = "", key = ""] = match;
  const expected = Buffer.from(key, "base64");
  const actual = yield* derive(check.password, Buffer.from(salt, "base64"), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });

  return (
    check.hash !== null && actual.length === expected.length && timingSafeEqual(actual, expected)
  );
});
