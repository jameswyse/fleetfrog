import { describe, expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer, Stream, SubscriptionRef } from "effect";

import { TestDatabase } from "../persistence/testDatabase.ts";
import { testHubConfig } from "../testHubConfig.ts";
import { AuthSettingsStore } from "./authSettingsStore.ts";

import type { SignInSwitches } from "@fleetfrog/protocol/domain/user";

const Dependencies = Layer.merge(TestDatabase, testHubConfig());
const TestStore = AuthSettingsStore.layer.pipe(Layer.provideMerge(Dependencies));

const reloaded = Layer.build(Layer.fresh(AuthSettingsStore.layer)).pipe(
  Effect.map((context) => Context.get(context, AuthSettingsStore)),
  Effect.flatMap(({ settings }) => SubscriptionRef.get(settings)),
);

const whileAnotherWriteHoldsTheSettings = Effect.fnUntraced(function* <A, E, R>(
  changes: Effect.Effect<A, E, R>,
) {
  const auth = yield* AuthSettingsStore;
  const holding = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();

  yield* SubscriptionRef.updateEffect(auth.settings, (current) =>
    Deferred.succeed(holding, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.as(current),
    ),
  ).pipe(Effect.forkScoped);

  yield* Deferred.await(holding);

  const running = yield* Effect.forkScoped(changes);

  yield* Effect.yieldNow;
  yield* Deferred.succeed(release, undefined);

  return yield* Fiber.join(running);
});

const turnOffUnlessLast = (method: keyof SignInSwitches) =>
  AuthSettingsStore.use((auth) =>
    auth.modify((current) => {
      const remaining = (["passwords", "provider", "tailscale"] as const).filter(
        (other) => other !== method && current[other],
      );

      return remaining.length === 0 ? [false, current] : [true, { ...current, [method]: false }];
    }),
  );

describe("AuthSettingsStore", () => {
  it.effect("applies changes queued behind another write to the settings that write left", () =>
    Effect.gen(function* () {
      const auth = yield* AuthSettingsStore;

      yield* auth.update((current) => ({ ...current, gravatar: true, passwords: false }));

      yield* whileAnotherWriteHoldsTheSettings(
        Effect.all(
          [
            auth.update((current) => ({ ...current, gravatar: false })),
            auth.update((current) => ({ ...current, passwords: true })),
          ],
          { concurrency: "unbounded" },
        ),
      );

      expect(yield* reloaded).toMatchObject({ gravatar: false, passwords: true });
    }).pipe(Effect.scoped, Effect.provide(TestStore)),
  );

  it.effect("checks each queued change against the settings the previous change left", () =>
    Effect.gen(function* () {
      const auth = yield* AuthSettingsStore;

      yield* auth.update((current) => ({
        ...current,
        passwords: true,
        provider: true,
        tailscale: false,
      }));

      const applied = yield* whileAnotherWriteHoldsTheSettings(
        Effect.all([turnOffUnlessLast("passwords"), turnOffUnlessLast("provider")], {
          concurrency: "unbounded",
        }),
      );

      const { passwords, provider } = yield* reloaded;

      expect(applied.filter(Boolean)).toHaveLength(1);
      expect([passwords, provider].filter(Boolean)).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(TestStore)),
  );

  it.effect("leaves the settings untouched when a change returns them unchanged", () =>
    Effect.gen(function* () {
      const auth = yield* AuthSettingsStore;

      yield* auth.update((current) => ({ ...current, gravatar: true }));

      const subscribed = yield* Deferred.make<void>();

      const published = yield* SubscriptionRef.changes(auth.settings).pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.map(({ gravatar }) => gravatar),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* Deferred.await(subscribed);
      yield* auth.modify((current) => [undefined, current]);
      yield* auth.update((current) => ({ ...current, gravatar: false }));

      expect(yield* Fiber.join(published)).toStrictEqual([true, false]);
    }).pipe(Effect.scoped, Effect.provide(TestStore)),
  );
});
