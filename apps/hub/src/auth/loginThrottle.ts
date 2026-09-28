import { Clock, Context, Duration, Effect, Layer, Option } from "effect";

/** Failed sign-ins allowed in a row before each attempt has to wait. */
const freeAttempts = 5;
const firstWait = Duration.seconds(30);
const longestWait = Duration.minutes(15);
/** Enough to hold every recent attempt without letting a flood of addresses grow memory without bound. */
const maximumEntries = 10_000;

interface Failures {
  readonly count: number;
  readonly lastAt: number;
}

/**
 * Slows password guessing for one email from one address. After five failures in a row, each
 * attempt waits twice as long as the one before, up to 15 minutes.
 */
export class LoginThrottle extends Context.Service<
  LoginThrottle,
  {
    /** How long before the next attempt may run, if it has to wait. */
    readonly wait: (key: string) => Effect.Effect<Option.Option<Duration.Duration>>;
    readonly recordFailure: (key: string) => Effect.Effect<void>;
    readonly recordSuccess: (key: string) => Effect.Effect<void>;
  }
>()("fleetfrog/LoginThrottle") {
  static readonly layer = Layer.sync(this)(() => {
    const failures = new Map<string, Failures>();

    return {
      wait: (key) =>
        Effect.gen(function* () {
          const entry = failures.get(key);

          if (entry === undefined || entry.count < freeAttempts) {
            return Option.none();
          }

          const wait = Duration.min(
            Duration.times(firstWait, 2 ** (entry.count - freeAttempts)),
            longestWait,
          );
          const remaining =
            entry.lastAt + Duration.toMillis(wait) - (yield* Clock.currentTimeMillis);

          return remaining > 0 ? Option.some(Duration.millis(remaining)) : Option.none();
        }),
      recordFailure: (key) =>
        Effect.gen(function* () {
          const count = (failures.get(key)?.count ?? 0) + 1;

          // Re-inserting moves the key to the end, so the first key is the stalest.
          failures.delete(key);
          failures.set(key, { count, lastAt: yield* Clock.currentTimeMillis });

          if (failures.size > maximumEntries) {
            failures.delete(failures.keys().next().value ?? key);
          }
        }),
      recordSuccess: (key) => Effect.sync(() => failures.delete(key)),
    };
  });
}
