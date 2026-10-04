import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";

import { LoginThrottle } from "./loginThrottle.ts";

import type { Attempt } from "./loginThrottle.ts";

const fail = (attempt: Attempt, times: number) =>
  LoginThrottle.use((throttle) =>
    Effect.forEach(Array.from({ length: times }), () => throttle.reserve(attempt)).pipe(
      Effect.map((waits) => waits.filter(Option.isNone).length),
    ),
  );

const ada = { email: "ada@example.com", address: "10.0.0.1" };

it.effect("lets five attempts at an email through, then makes each wait longer", () =>
  Effect.gen(function* () {
    const throttle = yield* LoginThrottle;

    expect(yield* fail(ada, 8)).toBe(5);
    expect(yield* throttle.reserve({ ...ada, address: "10.0.0.2" })).toEqual(
      Option.some(Duration.seconds(30)),
    );

    yield* TestClock.adjust(Duration.seconds(30));
    expect(yield* fail(ada, 2)).toBe(1);
    expect(yield* throttle.reserve(ada)).toEqual(Option.some(Duration.seconds(60)));
    expect(yield* throttle.reserve({ ...ada, email: "bo@example.com" })).toEqual(Option.none());
  }).pipe(Effect.provide(LoginThrottle.layer)),
);

it.effect("slows one address trying many emails", () =>
  Effect.gen(function* () {
    const throttle = yield* LoginThrottle;

    for (let i = 0; i < 20; i++) {
      yield* throttle.reserve({ email: `guess${i}@example.com`, address: "10.0.0.9" });
    }

    expect(yield* throttle.reserve({ email: "cy@example.com", address: "10.0.0.9" })).toEqual(
      Option.some(Duration.seconds(30)),
    );
    expect(yield* throttle.reserve(ada)).toEqual(Option.none());
  }).pipe(Effect.provide(LoginThrottle.layer)),
);

it.effect("doesn't count successful sign-ins against a shared address", () =>
  Effect.gen(function* () {
    const throttle = yield* LoginThrottle;

    for (let i = 0; i < 30; i++) {
      const attempt = { email: `person${i}@example.com`, address: "10.0.0.9" };

      expect(yield* throttle.reserve(attempt)).toEqual(Option.none());
      yield* throttle.succeeded(attempt);
    }
  }).pipe(Effect.provide(LoginThrottle.layer)),
);

it.effect("caps the wait at 15 minutes, clears it on success and forgets old failures", () =>
  Effect.gen(function* () {
    const throttle = yield* LoginThrottle;

    for (let i = 0; i < 12; i++) {
      yield* TestClock.adjust(Duration.minutes(i === 0 ? 0 : 15));
      yield* fail(ada, 1);
    }

    expect(yield* throttle.reserve(ada)).toEqual(Option.some(Duration.minutes(15)));

    yield* throttle.succeeded(ada);
    expect(yield* throttle.reserve(ada)).toEqual(Option.none());

    const bo = { email: "bo@example.com", address: null };

    yield* fail(bo, 4);
    yield* TestClock.adjust(Duration.minutes(16));
    expect(yield* fail(bo, 5)).toBe(5);
  }).pipe(Effect.provide(LoginThrottle.layer)),
);
