import { createHash, randomBytes } from "node:crypto";

import { Context, DateTime, Deferred, Duration, Effect, Layer, Option, Schema } from "effect";
import { Cookies, Headers } from "effect/http";
import { SqlClient } from "effect/sql";

import { NotSignedIn } from "@fleetfrog/protocol/dashboard/rpcs";
import { isSignInOn, UserId } from "@fleetfrog/protocol/domain/user";

import { AuthSettingsStore } from "./authSettingsStore.ts";
import { UserStore } from "./userStore.ts";

import type { Viewer } from "@fleetfrog/protocol/dashboard/rpcs";

export const sessionCookie = "fleetfrog_session";
export const sessionLifetime = Duration.days(30);

/** Session tokens are stored only as SHA-256 hashes. Their 256 random bits make a slow hash unnecessary. */
function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ user_id: UserId, expires_at: Schema.DateTimeUtcFromString })),
);

interface Connection {
  readonly sessionHash: string | null;
  readonly userId: UserId | null;
  readonly closed: Deferred.Deferred<void>;
}

/**
 * Dashboard sessions and the sockets open under them. Ending a session closes its sockets, so a
 * signed-out, deleted or demoted user stops receiving what they could see before.
 */
export class DashboardSessions extends Context.Service<
  DashboardSessions,
  {
    /** Who sent the request, from its session cookie. With sign-in off, anyone. */
    readonly viewer: (headers: Headers.Headers) => Effect.Effect<Viewer, NotSignedIn>;
    /** Starts a session for the user and returns its token for the cookie. */
    readonly start: (userId: UserId) => Effect.Effect<string>;
    /** Pushes the session's expiry back to a full lifetime from now. */
    readonly extend: (sessionHash: string) => Effect.Effect<void>;
    readonly end: (sessionHash: string) => Effect.Effect<void>;
    readonly endForUser: (
      userId: UserId,
      options?: { readonly except: string },
    ) => Effect.Effect<void>;
    /** Ends every session and closes every socket, including those opened with sign-in off. */
    readonly endAll: Effect.Effect<void>;
    /** Ends every session but the one given, and closes their sockets. */
    readonly endOthers: (sessionHash: string) => Effect.Effect<void>;
    /** Runs a dashboard socket until it closes or its session ends. */
    readonly connect: <A, E, R>(
      viewer: Viewer,
      socket: Effect.Effect<A, E, R>,
    ) => Effect.Effect<void, E, R>;
  }
>()("fleetfrog/DashboardSessions") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const auth = yield* AuthSettingsStore;
      const users = yield* UserStore;
      const connections = new Set<Connection>();
      const expiry = DateTime.now.pipe(
        Effect.map((now) => DateTime.formatIso(DateTime.addDuration(now, sessionLifetime))),
      );
      const close = (matches: (connection: Connection) => boolean) =>
        Effect.suspend(() =>
          Effect.forEach(
            [...connections].filter(matches),
            (connection) => Deferred.succeed(connection.closed, undefined),
            { discard: true },
          ),
        );

      yield* sql`delete from dashboard_sessions where expires_at < ${DateTime.formatIso(yield* DateTime.now)}`.pipe(
        Effect.orDie,
      );

      return {
        viewer: (headers) =>
          Effect.gen(function* () {
            if (!isSignInOn(yield* auth.methods)) {
              return { _tag: "Anyone" } as const;
            }

            const token = Headers.get(headers, "cookie").pipe(
              Option.flatMap((header) =>
                Option.fromUndefinedOr(Cookies.parseHeader(header)[sessionCookie]),
              ),
            );

            if (Option.isNone(token)) {
              return yield* new NotSignedIn();
            }

            const sessionHash = hashSessionToken(token.value);
            const [session] = yield* sql`
              select user_id, expires_at from dashboard_sessions where token_hash = ${sessionHash}
            `.pipe(Effect.flatMap(decodeRows), Effect.orDie);

            if (session === undefined || (yield* DateTime.isPast(session.expires_at))) {
              return yield* new NotSignedIn();
            }

            const user = yield* users
              .find(session.user_id)
              .pipe(Effect.catchTag("UserNotFound", () => Effect.fail(new NotSignedIn())));

            return { _tag: "SignedIn", userId: user.id, role: user.role, sessionHash } as const;
          }),
        start: (userId) =>
          Effect.gen(function* () {
            const token = randomBytes(32).toString("base64url");

            yield* sql`insert into dashboard_sessions ${sql.insert({
              token_hash: hashSessionToken(token),
              user_id: userId,
              created_at: DateTime.formatIso(yield* DateTime.now),
              expires_at: yield* expiry,
            })}`.pipe(Effect.orDie);
            yield* users.recordSignIn(userId);

            return token;
          }),
        extend: (sessionHash) =>
          expiry.pipe(
            Effect.flatMap(
              (expiresAt) =>
                sql`update dashboard_sessions set expires_at = ${expiresAt} where token_hash = ${sessionHash}`,
            ),
            Effect.orDie,
            Effect.asVoid,
          ),
        end: (sessionHash) =>
          sql`delete from dashboard_sessions where token_hash = ${sessionHash}`.pipe(
            Effect.orDie,
            Effect.andThen(close((connection) => connection.sessionHash === sessionHash)),
          ),
        endForUser: (userId, options) =>
          sql`
            delete from dashboard_sessions
            where user_id = ${userId} and token_hash != ${options?.except ?? ""}
          `.pipe(
            Effect.orDie,
            Effect.andThen(
              close(
                (connection) =>
                  connection.userId === userId && connection.sessionHash !== options?.except,
              ),
            ),
          ),
        endAll: sql`delete from dashboard_sessions`.pipe(
          Effect.orDie,
          Effect.andThen(close(() => true)),
        ),
        endOthers: (sessionHash) =>
          sql`delete from dashboard_sessions where token_hash != ${sessionHash}`.pipe(
            Effect.orDie,
            Effect.andThen(close((connection) => connection.sessionHash !== sessionHash)),
          ),
        connect: (viewer, socket) =>
          Effect.gen(function* () {
            const connection: Connection = {
              sessionHash: viewer._tag === "SignedIn" ? viewer.sessionHash : null,
              userId: viewer._tag === "SignedIn" ? viewer.userId : null,
              closed: yield* Deferred.make<void>(),
            };

            connections.add(connection);

            // Interrupting the socket's fiber closes it.
            yield* Effect.raceFirst(Effect.asVoid(socket), Deferred.await(connection.closed)).pipe(
              Effect.ensuring(Effect.sync(() => connections.delete(connection))),
            );
          }),
      };
    }),
  );
}
