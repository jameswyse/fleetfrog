import { createHash, randomUUID } from "node:crypto";

import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { SqlClient } from "effect/unstable/sql";

import { EmailTaken, LastAdmin, UserNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import { AvatarMediaType, Role, UserId } from "@fleetfrog/protocol/domain/user";

import { AuthSettingsStore } from "./authSettingsStore.ts";

import type { Avatar, Email, User } from "@fleetfrog/protocol/domain/user";

const Timestamp = Schema.DateTimeUtcFromString;

const UserRow = Schema.Struct({
  id: UserId,
  email: Schema.String,
  display_name: Schema.String,
  role: Role,
  password_hash: Schema.NullOr(Schema.String),
  oidc_issuer: Schema.NullOr(Schema.String),
  oidc_subject: Schema.NullOr(Schema.String),
  provider_name: Schema.NullOr(Schema.String),
  provider_picture: Schema.NullOr(Schema.String),
  avatar_id: Schema.NullOr(Schema.String),
  created_at: Timestamp,
  last_signed_in_at: Schema.NullOr(Timestamp),
});

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(UserRow));
const decodeAvatars = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ media_type: AvatarMediaType, data: Schema.Uint8Array })),
);

/** A dashboard user as stored, including what only the hub sees. */
export interface UserRecord {
  readonly id: UserId;
  readonly email: string;
  /** The name the user or an admin chose, which the provider's name takes precedence over. */
  readonly displayName: string;
  readonly role: Role;
  readonly passwordHash: string | null;
  readonly oidc: { readonly issuer: string; readonly subject: string } | null;
  readonly providerName: string | null;
  readonly providerPicture: string | null;
  /** The content hash of the uploaded picture. */
  readonly avatarId: string | null;
  readonly createdAt: DateTime.Utc;
  readonly lastSignedInAt: DateTime.Utc | null;
}

export interface ProviderIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: Email;
  readonly name: string | null;
  readonly picture: string | null;
  readonly role: Role | null;
}

export interface UploadedAvatar {
  readonly mediaType: AvatarMediaType;
  readonly data: Uint8Array;
}

function toRecord(row: typeof UserRow.Type): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    passwordHash: row.password_hash,
    oidc:
      row.oidc_issuer === null || row.oidc_subject === null
        ? null
        : { issuer: row.oidc_issuer, subject: row.oidc_subject },
    providerName: row.provider_name,
    providerPicture: row.provider_picture,
    avatarId: row.avatar_id,
    createdAt: row.created_at,
    lastSignedInAt: row.last_signed_in_at,
  };
}

/** The provider's picture wins, then an uploaded one, then Gravatar when it's on. */
function avatarOf(record: UserRecord, gravatar: boolean): Avatar {
  if (record.providerPicture !== null) {
    return { _tag: "Provider", url: record.providerPicture };
  }

  if (record.avatarId !== null) {
    return { _tag: "Uploaded", id: record.avatarId };
  }

  return gravatar
    ? { _tag: "Gravatar", hash: createHash("sha256").update(record.email).digest("hex") }
    : { _tag: "None" };
}

export function describeUser(record: UserRecord, gravatar: boolean): User {
  return {
    id: record.id,
    email: record.email,
    displayName: record.providerName ?? record.displayName,
    role: record.role,
    avatar: avatarOf(record, gravatar),
    displayNameFromProvider: record.providerName !== null,
    hasPassword: record.passwordHash !== null,
    linkedToProvider: record.oidc !== null,
    createdAt: record.createdAt,
    lastSignedInAt: record.lastSignedInAt,
  };
}

/** Dashboard users, kept in memory and written through to the database. */
export class UserStore extends Context.Service<
  UserStore,
  {
    readonly records: SubscriptionRef.SubscriptionRef<ReadonlyArray<UserRecord>>;
    /** Every user as the dashboard shows them, on subscribe and after every change. */
    readonly watch: Stream.Stream<ReadonlyArray<User>>;
    readonly describe: (record: UserRecord) => Effect.Effect<User>;
    readonly find: (id: UserId) => Effect.Effect<UserRecord, UserNotFound>;
    readonly findByEmail: (email: Email) => Effect.Effect<Option.Option<UserRecord>>;
    readonly create: (user: {
      readonly email: Email;
      readonly displayName: string;
      readonly role: Role;
      readonly passwordHash: string | null;
    }) => Effect.Effect<UserRecord, EmailTaken>;
    /** Fails rather than leave the hub without an admin. */
    readonly update: (update: {
      readonly userId: UserId;
      readonly email: Email;
      readonly displayName: string;
      readonly role: Role;
    }) => Effect.Effect<void, UserNotFound | EmailTaken | LastAdmin>;
    readonly setPasswordHash: (update: {
      readonly userId: UserId;
      readonly passwordHash: string;
    }) => Effect.Effect<void, UserNotFound>;
    readonly setDisplayName: (update: {
      readonly userId: UserId;
      readonly displayName: string;
    }) => Effect.Effect<void, UserNotFound>;
    readonly setAvatar: (update: {
      readonly userId: UserId;
      readonly avatar: UploadedAvatar | null;
    }) => Effect.Effect<void, UserNotFound>;
    readonly findAvatar: (id: string) => Effect.Effect<Option.Option<UploadedAvatar>>;
    /** Fails rather than leave the hub without an admin. */
    readonly remove: (userId: UserId) => Effect.Effect<void, UserNotFound | LastAdmin>;
    readonly recordSignIn: (userId: UserId) => Effect.Effect<void>;
    /**
     * The user the provider signed in, found by their provider account, then by email, or
     * created. Their email, name and picture follow the provider's. With a role, it replaces
     * theirs; without one, a new user is a user.
     */
    readonly signInFromProvider: (
      identity: ProviderIdentity,
    ) => Effect.Effect<{ readonly user: UserRecord; readonly roleChanged: boolean }, EmailTaken>;
  }
>()("fleetfrog/UserStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const auth = yield* AuthSettingsStore;
      const load = sql`
        select users.*, user_avatars.id as avatar_id
        from users left join user_avatars on user_avatars.user_id = users.id
        order by users.created_at
      `.pipe(Effect.flatMap(decodeRows), Effect.orDie);
      const records = yield* SubscriptionRef.make<ReadonlyArray<UserRecord>>(
        (yield* load).map(toRecord),
      );
      // Checks such as the last admin read memory, so writes run one at a time.
      const writes = yield* Semaphore.make(1);
      const write = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.tap(() =>
            load.pipe(Effect.flatMap((rows) => SubscriptionRef.set(records, rows.map(toRecord)))),
          ),
          Semaphore.withPermits(writes, 1),
        );
      const find = (id: UserId) =>
        SubscriptionRef.get(records).pipe(
          Effect.map((all) => all.find((record) => record.id === id)),
          Effect.flatMap((record) =>
            record === undefined
              ? Effect.fail(new UserNotFound({ userId: id }))
              : Effect.succeed(record),
          ),
        );
      const emailTaken = (email: string, except: UserId | null) =>
        SubscriptionRef.get(records).pipe(
          Effect.map((all) => all.some((record) => record.email === email && record.id !== except)),
        );
      const otherAdmins = (userId: UserId) =>
        SubscriptionRef.get(records).pipe(
          Effect.map(
            (all) => all.filter((record) => record.role === "admin" && record.id !== userId).length,
          ),
        );
      const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

      return {
        records,
        watch: Stream.zipLatest(
          SubscriptionRef.changes(records),
          SubscriptionRef.changes(auth.settings),
        ).pipe(
          Stream.map(([all, { gravatar }]) => all.map((record) => describeUser(record, gravatar))),
        ),
        describe: (record) =>
          SubscriptionRef.get(auth.settings).pipe(
            Effect.map(({ gravatar }) => describeUser(record, gravatar)),
          ),
        find,
        findByEmail: (email) =>
          SubscriptionRef.get(records).pipe(
            Effect.map((all) =>
              Option.fromUndefinedOr(all.find((record) => record.email === email)),
            ),
          ),
        create: (user) =>
          write(
            Effect.gen(function* () {
              if (yield* emailTaken(user.email, null)) {
                return yield* new EmailTaken();
              }

              const id = UserId.make(randomUUID());

              yield* sql`insert into users ${sql.insert({
                id,
                email: user.email,
                display_name: user.displayName,
                role: user.role,
                password_hash: user.passwordHash,
                created_at: yield* now,
              })}`.pipe(Effect.orDie);

              return id;
            }),
          ).pipe(Effect.flatMap((id) => find(id).pipe(Effect.orDie))),
        update: ({ userId, email, displayName, role }) =>
          write(
            Effect.gen(function* () {
              const record = yield* find(userId);

              if (yield* emailTaken(email, userId)) {
                return yield* new EmailTaken();
              }

              if (
                record.role === "admin" &&
                role !== "admin" &&
                (yield* otherAdmins(userId)) === 0
              ) {
                return yield* new LastAdmin();
              }

              return yield* sql`
                update users set email = ${email}, display_name = ${displayName}, role = ${role}
                where id = ${userId}
              `.pipe(Effect.orDie, Effect.asVoid);
            }),
          ),
        setPasswordHash: ({ userId, passwordHash }) =>
          write(
            find(userId).pipe(
              Effect.andThen(
                sql`update users set password_hash = ${passwordHash} where id = ${userId}`,
              ),
              Effect.catchTag("SqlError", Effect.die),
            ),
          ),
        setDisplayName: ({ userId, displayName }) =>
          write(
            find(userId).pipe(
              Effect.andThen(
                sql`update users set display_name = ${displayName} where id = ${userId}`,
              ),
              Effect.catchTag("SqlError", Effect.die),
            ),
          ),
        setAvatar: ({ userId, avatar }) =>
          write(
            Effect.gen(function* () {
              yield* find(userId);
              yield* sql`delete from user_avatars where user_id = ${userId}`.pipe(Effect.orDie);

              if (avatar !== null) {
                yield* sql`insert into user_avatars ${sql.insert({
                  user_id: userId,
                  id: createHash("sha256").update(avatar.data).digest("hex"),
                  media_type: avatar.mediaType,
                  data: avatar.data,
                })}`.pipe(Effect.orDie);
              }
            }),
          ),
        findAvatar: (id) =>
          sql`select media_type, data from user_avatars where id = ${id} limit 1`.pipe(
            Effect.flatMap(decodeAvatars),
            Effect.map(([row]) =>
              Option.fromUndefinedOr(row).pipe(
                Option.map(({ media_type, data }) => ({ mediaType: media_type, data })),
              ),
            ),
            Effect.orDie,
          ),
        remove: (userId) =>
          write(
            Effect.gen(function* () {
              const record = yield* find(userId);

              if (record.role === "admin" && (yield* otherAdmins(userId)) === 0) {
                return yield* new LastAdmin();
              }

              yield* sql`delete from user_avatars where user_id = ${userId}`.pipe(Effect.orDie);

              return yield* sql`delete from users where id = ${userId}`.pipe(
                Effect.orDie,
                Effect.asVoid,
              );
            }),
          ),
        signInFromProvider: (identity) =>
          write(
            Effect.gen(function* () {
              const all = yield* SubscriptionRef.get(records);
              const existing =
                all.find(
                  ({ oidc }) =>
                    oidc?.issuer === identity.issuer && oidc.subject === identity.subject,
                ) ?? all.find(({ email }) => email === identity.email);
              const fields = {
                email: identity.email,
                oidc_issuer: identity.issuer,
                oidc_subject: identity.subject,
                provider_name: identity.name,
                provider_picture: identity.picture,
              };

              if (yield* emailTaken(identity.email, existing?.id ?? null)) {
                return yield* new EmailTaken();
              }

              if (existing === undefined) {
                const id = UserId.make(randomUUID());

                yield* sql`insert into users ${sql.insert({
                  ...fields,
                  id,
                  display_name: identity.name ?? identity.email.split("@")[0] ?? identity.email,
                  role: identity.role ?? "user",
                  created_at: yield* now,
                })}`.pipe(Effect.orDie);

                return { id, roleChanged: false };
              }

              const role = identity.role ?? existing.role;

              yield* sql`update users set ${sql.update({ ...fields, role })} where id = ${existing.id}`.pipe(
                Effect.orDie,
              );

              return { id: existing.id, roleChanged: role !== existing.role };
            }),
          ).pipe(
            Effect.flatMap(({ id, roleChanged }) =>
              find(id).pipe(
                Effect.map((user) => ({ user, roleChanged })),
                Effect.orDie,
              ),
            ),
          ),
        recordSignIn: (userId) =>
          write(
            now.pipe(
              Effect.flatMap(
                (at) => sql`update users set last_signed_in_at = ${at} where id = ${userId}`,
              ),
              Effect.orDie,
              Effect.asVoid,
            ),
          ),
      };
    }),
  );
}
