import { Clock, Context, Duration, Effect, Layer, Option } from "effect";

const firstWait = Duration.seconds(30);
const longestWait = Duration.minutes(15);
/**
 * Failed sign-ins allowed in a row before each attempt has to wait. An address gets more, because
 * behind a reverse proxy everyone shares the proxy's address.
 */
const freeAttempts = { email: 5, address: 20 } as const;
/** Enough to hold every recent attempt without letting a flood of addresses grow memory without bound. */
const maximumEntries = 10_000;

interface Failures {
  readonly count: number;
  readonly lastAt: number;
}

export interface Attempt {
  readonly email: string;
  /** Where the attempt came from, or null when that doesn't apply, such as a password change. */
  readonly address: string | null;
}

/**
 * Slows password guessing, both against one email and from one address. Past each one's free
 * failures, every attempt waits twice as long as the one before, up to 15 minutes. An attempt is
 * counted before its password is checked, so guesses sent all at once are slowed too.
 */
export class LoginThrottle extends Context.Service<
  LoginThrottle,
  {
    /**
     * Counts an attempt as failed until it succeeds, or returns how long to wait first without
     * counting it.
     */
    readonly reserve: (attempt: Attempt) => Effect.Effect<Option.Option<Duration.Duration>>;
    /** Clears the email's failures and takes back the address's count for this attempt. */
    readonly succeeded: (attempt: Attempt) => Effect.Effect<void>;
  }
>()("fleetfrog/LoginThrottle") {
  static readonly layer = Layer.sync(this)(() => {
    const failures = new Map<string, Failures>();
    const emailKey = (email: string) => `email ${email}`;

    const keys = ({ email, address }: Attempt) => [
      [emailKey(email), freeAttempts.email] as const,
      ...(address === null ? [] : [[`address ${address}`, freeAttempts.address] as const]),
    ];

    const remaining = (key: string, free: number, now: number) => {
      const entry = failures.get(key);

      if (entry === undefined || entry.count < free) {
        return 0;
      }

      const wait = Duration.min(Duration.times(firstWait, 2 ** (entry.count - free)), longestWait);

      return entry.lastAt + Duration.toMillis(wait) - now;
    };

    const count = (key: string, now: number) => {
      const previous = failures.get(key);

      // After a quiet spell the count starts again, so old failures don't add up forever.
      const recent =
        previous !== undefined && now - previous.lastAt <= Duration.toMillis(longestWait);

      // Re-inserting moves the key to the end, so the first key is the stalest.
      failures.delete(key);
      failures.set(key, { count: (recent ? previous.count : 0) + 1, lastAt: now });
    };

    return {
      // Checking and counting happen in one step, so no attempt slips in between.
      reserve: (attempt) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => {
            const longest = Math.max(
              ...keys(attempt).map(([key, free]) => remaining(key, free, now)),
            );

            if (longest > 0) {
              return Option.some(Duration.millis(longest));
            }

            for (const [key] of keys(attempt)) {
              count(key, now);
            }

            while (failures.size > maximumEntries) {
              failures.delete(failures.keys().next().value ?? "");
            }

            return Option.none();
          }),
        ),
      // Others may still be guessing from the same address, so only this attempt comes off it.
      succeeded: (attempt) =>
        Effect.sync(() => {
          failures.delete(emailKey(attempt.email));

          for (const [key] of keys(attempt).slice(1)) {
            const entry = failures.get(key);

            if (entry !== undefined) {
              failures.set(key, { ...entry, count: Math.max(0, entry.count - 1) });
            }
          }
        }),
    };
  });
}
