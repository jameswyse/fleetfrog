import { Clock, Context, Duration, Effect, Layer, Option } from "effect";

const firstWait = Duration.seconds(30);
const longestWait = Duration.minutes(15);
const freeAttempts = { email: 5, address: 20 } as const;
const maximumEntries = 10_000;

interface Failures {
  readonly count: number;
  readonly lastAt: number;
}

export interface Attempt {
  readonly email: string;
  readonly address: string | null;
}

export class LoginThrottle extends Context.Service<
  LoginThrottle,
  {
    readonly reserve: (attempt: Attempt) => Effect.Effect<Option.Option<Duration.Duration>>;
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

      const recent =
        previous !== undefined && now - previous.lastAt <= Duration.toMillis(longestWait);

      failures.delete(key);
      failures.set(key, { count: (recent ? previous.count : 0) + 1, lastAt: now });
    };

    return {
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
