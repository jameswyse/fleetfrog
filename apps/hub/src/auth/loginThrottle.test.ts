import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";

import { LoginThrottle } from "./loginThrottle.ts";

const fail = (key: string, times: number) =>
  LoginThrottle.use((throttle) => Effect.repeat(throttle.recordFailure(key), { times: times - 1 }));

it.effect("lets five failures through, then makes each attempt wait longer", () =>
  Effect.gen(function* () {
    const throttle = yield* LoginThrottle;

    yield* fail("a", 5);
    expect(yield* throttle.wait("a")).toEqual(Option.some(Duration.seconds(30)));

    yield* TestClock.adjust(Duration.seconds(30));
    expect(yield* throttle.wait("a")).toEqual(Option.none());

    yield* fail("a", 1);
    expect(yield* throttle.wait("a")).toEqual(Option.some(Duration.seconds(60)));
    expect(yield* throttle.wait("b")).toEqual(Option.none());
  }).pipe(Effect.provide(LoginThrottle.layer)),
);

it.effect("caps the wait at 15 minutes and clears it on success", () =>
  Effect.gen(function* () {
    const throttle = yield* LoginThrottle;

    yield* fail("a", 20);
    expect(yield* throttle.wait("a")).toEqual(Option.some(Duration.minutes(15)));

    yield* throttle.recordSuccess("a");
    expect(yield* throttle.wait("a")).toEqual(Option.none());
  }).pipe(Effect.provide(LoginThrottle.layer)),
);
