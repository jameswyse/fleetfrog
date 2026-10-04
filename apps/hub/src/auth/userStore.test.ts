import { SqliteClient } from "@effect/sql-sqlite-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { defaultAuthSettings, Email } from "@fleetfrog/protocol/domain/user";

import { HubConfig } from "../hubConfig.ts";
import { Migrations } from "../persistence/database.ts";
import { AuthSettingsStore } from "./authSettingsStore.ts";
import { UserStore } from "./userStore.ts";

import type { Role } from "@fleetfrog/protocol/domain/user";

/** A fresh, fully migrated database for each test. */
const TestStore = UserStore.layer.pipe(
  Layer.provideMerge(AuthSettingsStore.layer),
  Layer.provide(Migrations.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))),
  Layer.provide(
    Layer.succeed(HubConfig)({
      dataDirectory: "unused",
      host: null,
      dashboardPort: 7420,
      agentPort: 7421,
      agentTls: "self-signed",
      agentUrl: null,
      tailscaleSocket: null,
      dashboardSocket: null,
      webRoot: null,
      authModeOverride: null,
    }),
  ),
);

const create = (email: string, role: Role) =>
  UserStore.use((users) =>
    users.create({ email: Email.make(email), displayName: email, role, passwordHash: null }),
  );

it.effect("won't demote or remove the last admin", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;
    const admin = yield* create("ada@example.com", "admin");
    const user = yield* create("bo@example.com", "user");

    const demote = users.update({
      userId: admin.id,
      email: Email.make(admin.email),
      displayName: admin.displayName,
      role: "user",
    });

    expect((yield* Effect.flip(demote))._tag).toBe("LastAdmin");
    expect((yield* Effect.flip(users.remove(admin.id)))._tag).toBe("LastAdmin");

    yield* users.update({
      userId: user.id,
      email: Email.make(user.email),
      displayName: user.displayName,
      role: "admin",
    });
    yield* users.remove(admin.id);

    expect((yield* users.find(user.id)).role).toBe("admin");
    expect((yield* Effect.flip(users.find(admin.id)))._tag).toBe("UserNotFound");
  }).pipe(Effect.provide(TestStore)),
);

it.effect("keeps emails unique", () =>
  Effect.gen(function* () {
    yield* create("ada@example.com", "admin");

    expect((yield* Effect.flip(create("ada@example.com", "user")))._tag).toBe("EmailTaken");
  }).pipe(Effect.provide(TestStore)),
);

it.effect(
  "links a provider sign-in to the account with that email, then follows the provider account",
  () =>
    Effect.gen(function* () {
      const users = yield* UserStore;
      const local = yield* create("ada@example.com", "admin");

      // Another admin, so the provider's group may demote Ada.
      yield* create("cy@example.com", "admin");

      const identity = {
        issuer: "https://auth.example.com",
        subject: "ada-at-provider",
        name: "Ada Lovelace",
        picture: null,
        emailVerified: true,
        role: null,
      };

      const first = yield* users.signInFromProvider({
        ...identity,
        email: Email.make("ada@example.com"),
      });

      expect(first.user.id).toBe(local.id);
      expect(first.user.role).toBe("admin");
      expect(first.user.providerName).toBe("Ada Lovelace");

      // The provider changed their email; the provider account still finds them.
      const moved = yield* users.signInFromProvider({
        ...identity,
        email: Email.make("ada@newmail.example"),
        role: "user",
      });

      expect(moved.user.id).toBe(local.id);
      expect(moved.user.email).toBe("ada@newmail.example");
      expect(moved.roleChanged).toBe(true);

      const stranger = yield* users.signInFromProvider({
        ...identity,
        subject: "someone-else",
        email: Email.make("bo@example.com"),
      });

      expect(stranger.user.id).not.toBe(local.id);
      expect(stranger.user.role).toBe("user");
    }).pipe(Effect.provide(TestStore)),
);

it.effect("won't hand an account linked at this provider to another of its accounts", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;

    const identity = {
      issuer: "https://auth.example.com",
      email: Email.make("ada@example.com"),
      name: null,
      picture: null,
      emailVerified: null,
      role: null,
    };

    yield* users.signInFromProvider({ ...identity, subject: "ada-at-provider" });

    const impostor = yield* Effect.flip(
      users.signInFromProvider({ ...identity, subject: "someone-else" }),
    );

    expect(impostor._tag).toBe("EmailTaken");
  }).pipe(Effect.provide(TestStore)),
);

it.effect("keeps the last admin an admin when the provider's group would demote them", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;

    yield* create("ada@example.com", "admin");

    const signedIn = yield* users.signInFromProvider({
      issuer: "https://auth.example.com",
      subject: "ada-at-provider",
      email: Email.make("ada@example.com"),
      name: null,
      picture: null,
      emailVerified: true,
      role: "user",
    });

    expect(signedIn.user.role).toBe("admin");
    expect(signedIn.roleChanged).toBe(false);
  }).pipe(Effect.provide(TestStore)),
);

it.effect("won't link an account by an email the provider hasn't verified", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;

    yield* create("ada@example.com", "admin");

    const unverified = yield* Effect.flip(
      users.signInFromProvider({
        issuer: "https://auth.example.com",
        subject: "someone",
        email: Email.make("ada@example.com"),
        name: null,
        picture: null,
        emailVerified: false,
        role: null,
      }),
    );

    expect(unverified._tag).toBe("EmailTaken");
  }).pipe(Effect.provide(TestStore)),
);

it.effect("uses the provider's name only while people sign in through it", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;
    const auth = yield* AuthSettingsStore;

    const { user } = yield* users.signInFromProvider({
      issuer: "https://auth.example.com",
      subject: "ada-at-provider",
      email: Email.make("ada@example.com"),
      name: "Ada from the provider",
      picture: null,
      emailVerified: true,
      role: null,
    });

    yield* users.setDisplayName({ userId: user.id, displayName: "Ada" });

    const current = yield* users.find(user.id);

    expect((yield* users.describe(current)).displayName).toBe("Ada");

    yield* auth.update({ ...defaultAuthSettings, provider: true });

    const described = yield* users.describe(current);

    expect(described.displayName).toBe("Ada from the provider");
    expect(described.displayNameFromProvider).toBe(true);
  }).pipe(Effect.provide(TestStore)),
);

const tailnetUser = (login: string, admin = false) => ({
  login,
  email: Email.make(login),
  name: login.split("@")[0] ?? login,
  admin,
});

it.effect("links a Tailscale sign-in by email, then follows the tailnet login", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;
    const local = yield* create("ada@example.com", "user");
    const first = yield* users.signInFromTailscale(tailnetUser("ada@example.com"));

    expect(first).toMatchObject({ id: local.id, tailscaleLogin: "ada@example.com" });

    // Ada moves to another email, and someone else takes the old one.
    yield* users.update({
      userId: local.id,
      email: Email.make("ada@work.example"),
      displayName: local.displayName,
      role: "user",
    });
    yield* create("ada@example.com", "user");

    expect((yield* users.signInFromTailscale(tailnetUser("ada@example.com"))).id).toBe(local.id);
  }).pipe(Effect.provide(TestStore)),
);

it.effect("creates a user for a new tailnet login, and an admin when turning Tailscale on", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;
    const newcomer = yield* users.signInFromTailscale(tailnetUser("bo@example.com"));
    const promoted = yield* users.signInFromTailscale(tailnetUser("bo@example.com", true));

    expect(newcomer.role).toBe("user");
    expect(promoted).toMatchObject({ id: newcomer.id, role: "admin" });
  }).pipe(Effect.provide(TestStore)),
);

it.effect("won't hand an account linked to one tailnet login to another with its email", () =>
  Effect.gen(function* () {
    const users = yield* UserStore;
    const ada = yield* users.signInFromTailscale(tailnetUser("ada@github"));

    yield* users.update({
      userId: ada.id,
      email: Email.make("ada@example.com"),
      displayName: ada.displayName,
      role: "user",
    });

    const other = yield* Effect.flip(users.signInFromTailscale(tailnetUser("ada@example.com")));

    expect(other._tag).toBe("EmailTaken");
  }).pipe(Effect.provide(TestStore)),
);
