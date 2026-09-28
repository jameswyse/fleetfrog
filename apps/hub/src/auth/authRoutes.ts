import { Duration, Effect, Layer, Option, Schema, SubscriptionRef } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  LoginFailure,
  LoginRequest,
  ModeChange,
  Session,
} from "@fleetfrog/protocol/dashboard/auth";
import { viewerRole } from "@fleetfrog/protocol/dashboard/rpcs";

import { isCrossOrigin } from "../http/sameOrigin.ts";
import { AuthSettingsStore } from "./authSettingsStore.ts";
import { DashboardSessions, sessionCookie, sessionLifetime } from "./dashboardSessions.ts";
import { LoginThrottle } from "./loginThrottle.ts";
import { checkPassword, hashPassword } from "./passwords.ts";
import { UserStore } from "./userStore.ts";

import type { SignInMethod } from "@fleetfrog/protocol/dashboard/auth";
import type { UserId } from "@fleetfrog/protocol/domain/user";

const sessionJson = HttpServerResponse.schemaJson(Schema.toCodecJson(Session));
const failureJson = HttpServerResponse.schemaJson(Schema.toCodecJson(LoginFailure));

/** Browsers drop a `Secure` cookie sent over plain HTTP, so it's secure only behind HTTPS. */
function cookieOptions(request: HttpServerRequest.HttpServerRequest) {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: Headers.get(request.headers, "x-forwarded-proto").pipe(
      Option.exists((protocol) => protocol === "https"),
    ),
  } as const;
}

const forbidden = HttpServerResponse.text("Forbidden.", { status: 403 });

/** Describes the session of the signed-in user, if any, for the dashboard. */
const describeSession = Effect.fnUntraced(function* (userId: UserId | null) {
  const auth = yield* AuthSettingsStore;
  const users = yield* UserStore;
  const { oidc } = yield* SubscriptionRef.get(auth.settings);
  const mode = yield* auth.mode;
  const method: SignInMethod =
    mode === "oidc" ? { _tag: "Provider", name: oidc?.providerName ?? "" } : { _tag: "Password" };

  if (mode === "none") {
    return Session.cases.Open.make({});
  }

  if (userId === null) {
    return Session.cases.SignedOut.make({ method });
  }

  const user = yield* users.find(userId).pipe(Effect.flatMap(users.describe), Effect.orDie);

  return Session.cases.SignedIn.make({ method, user });
});

/** Starts a session for the user and answers with it, setting its cookie. */
const signIn = Effect.fnUntraced(function* (userId: UserId) {
  const sessions = yield* DashboardSessions;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const token = yield* sessions.start(userId);
  const response = yield* sessionJson(yield* describeSession(userId));

  return yield* HttpServerResponse.setCookie(response, sessionCookie, token, {
    ...cookieOptions(request),
    maxAge: sessionLifetime,
  });
});

const session = HttpRouter.add(
  "GET",
  "/auth/session",
  Effect.gen(function* () {
    const sessions = yield* DashboardSessions;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const viewer = yield* sessions
      .viewer(request.headers)
      .pipe(Effect.catchTag("NotSignedIn", () => Effect.succeed(null)));
    const response = yield* sessionJson(
      yield* describeSession(viewer?._tag === "SignedIn" ? viewer.userId : null),
    );
    const token = request.cookies[sessionCookie];

    if (viewer?._tag !== "SignedIn" || token === undefined) {
      return response;
    }

    // Each visit keeps the session going for another full lifetime.
    yield* sessions.extend(viewer.sessionHash);

    return yield* HttpServerResponse.setCookie(response, sessionCookie, token, {
      ...cookieOptions(request),
      maxAge: sessionLifetime,
    });
  }).pipe(Effect.orDie),
);

const login = HttpRouter.add(
  "POST",
  "/auth/login",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* AuthSettingsStore;
    const users = yield* UserStore;
    const throttle = yield* LoginThrottle;

    if (isCrossOrigin(request.headers)) {
      return forbidden;
    }

    if ((yield* auth.mode) !== "local") {
      return HttpServerResponse.text("Password sign-in is off.", { status: 409 });
    }

    const body = yield* HttpServerRequest.schemaBodyJson(LoginRequest).pipe(Effect.option);

    if (Option.isNone(body)) {
      return HttpServerResponse.text("Expected an email and password.", { status: 400 });
    }

    const { email, password } = body.value;
    const key = `${Option.getOrElse(request.remoteAddress, () => "")} ${email}`;
    const wait = yield* throttle.wait(key);

    if (Option.isSome(wait)) {
      return yield* failureJson(
        LoginFailure.cases.TooManyAttempts.make({
          retryAfterSeconds: Math.ceil(Duration.toSeconds(wait.value)),
        }),
        { status: 429 },
      );
    }

    const user = yield* users.findByEmail(email);
    const valid = yield* checkPassword({
      password,
      hash: Option.match(user, { onNone: () => null, onSome: (found) => found.passwordHash }),
    });

    if (!valid || Option.isNone(user)) {
      yield* throttle.recordFailure(key);

      return yield* failureJson(LoginFailure.cases.InvalidCredentials.make({}), { status: 401 });
    }

    yield* throttle.recordSuccess(key);

    return yield* signIn(user.value.id);
  }).pipe(Effect.orDie),
);

const logout = HttpRouter.add(
  "POST",
  "/auth/logout",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const sessions = yield* DashboardSessions;

    if (isCrossOrigin(request.headers)) {
      return forbidden;
    }

    const viewer = yield* sessions.viewer(request.headers).pipe(Effect.option);

    if (Option.isSome(viewer) && viewer.value._tag === "SignedIn") {
      yield* sessions.end(viewer.value.sessionHash);
    }

    return yield* HttpServerResponse.expireCookie(
      HttpServerResponse.empty({ status: 204 }),
      sessionCookie,
      cookieOptions(request),
    );
  }).pipe(Effect.orDie),
);

const changeMode = HttpRouter.add(
  "POST",
  "/auth/mode",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* AuthSettingsStore;
    const users = yield* UserStore;
    const sessions = yield* DashboardSessions;

    if (isCrossOrigin(request.headers)) {
      return forbidden;
    }

    const viewer = yield* sessions.viewer(request.headers).pipe(Effect.option);

    if (Option.isNone(viewer) || viewerRole(viewer.value) !== "admin") {
      return forbidden;
    }

    if (auth.overridden) {
      return HttpServerResponse.text("FLEETFROG_AUTH_MODE has turned sign-in off.", {
        status: 409,
      });
    }

    const body = yield* HttpServerRequest.schemaBodyJson(ModeChange).pipe(Effect.option);

    if (Option.isNone(body)) {
      return HttpServerResponse.text("Expected a mode change.", { status: 400 });
    }

    const settings = yield* SubscriptionRef.get(auth.settings);
    const change = body.value;

    if (change._tag === "None") {
      yield* auth.update({ ...settings, mode: "none" });
      yield* sessions.endAll;

      return yield* HttpServerResponse.expireCookie(
        yield* sessionJson(Session.cases.Open.make({})),
        sessionCookie,
        cookieOptions(request),
      );
    }

    // The admin's own account, found by email or created, becomes an admin with this password.
    const passwordHash = yield* hashPassword(change.password);
    const existing = yield* users.findByEmail(change.email);
    const userId = Option.isSome(existing)
      ? existing.value.id
      : (yield* users.create({
          email: change.email,
          displayName: change.displayName,
          role: "admin",
          passwordHash,
        })).id;

    if (Option.isSome(existing)) {
      yield* users.update({
        userId,
        email: change.email,
        displayName: change.displayName,
        role: "admin",
      });
      yield* users.setPasswordHash({ userId, passwordHash });
    }

    yield* auth.update({ ...settings, mode: "local" });
    yield* sessions.endAll;

    return yield* signIn(userId);
  }).pipe(Effect.orDie),
);

/**
 * Uploaded pictures by the hash of their bytes, so browsers keep each one for good. Only PNG,
 * JPEG and WebP are accepted, and they're sandboxed like project icons all the same.
 */
const avatars = HttpRouter.add(
  "GET",
  "/avatars/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const avatar =
      id === undefined ? Option.none() : yield* UserStore.use((store) => store.findAvatar(id));

    return Option.match(avatar, {
      onNone: () => HttpServerResponse.text("No such picture.", { status: 404 }),
      onSome: ({ mediaType, data }) =>
        HttpServerResponse.uint8Array(data, {
          contentType: mediaType,
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "content-security-policy": "default-src 'none'; sandbox",
            "x-content-type-options": "nosniff",
          },
        }),
    });
  }),
);

/** Sign-in over plain HTTP, since the dashboard socket needs the session cookie first. */
export const AuthRoutes = Layer.mergeAll(session, login, logout, changeMode, avatars);
