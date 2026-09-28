import { Duration, Effect, Layer, Option, Result, Schema, SubscriptionRef } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  localPath,
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
import { OidcSignIn } from "./oidcSignIn.ts";
import { checkPassword, hashPassword } from "./passwords.ts";
import { UserStore } from "./userStore.ts";

import type { Cause } from "effect";

import type { SignInMethod } from "@fleetfrog/protocol/dashboard/auth";
import type { UserId } from "@fleetfrog/protocol/domain/user";

import type { OidcIntent } from "./oidcSignIn.ts";

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
    const attempt = { email, address: Option.getOrElse(request.remoteAddress, () => "") };
    const wait = yield* throttle.reserve(attempt);

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
      return yield* failureJson(LoginFailure.cases.InvalidCredentials.make({}), { status: 401 });
    }

    yield* throttle.succeeded(attempt);

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

/** Binds a provider sign-in to the browser that started it, so a stolen callback link is useless. */
const oidcStateCookie = "fleetfrog_oidc_state";

/** Where a failed provider sign-in sends the browser, with why, logged for the admin too. */
function failed(intent: OidcIntent, message: string) {
  const page = intent === "Activate" ? "/settings/authentication" : "/login";

  return Effect.logWarning("Sign-in through the provider didn't work").pipe(
    Effect.annotateLogs({ intent, reason: message }),
    Effect.as(
      HttpServerResponse.redirect(
        `${page}?${new URLSearchParams({ failure: message }).toString()}`,
      ),
    ),
  );
}

/** The dashboard's router doesn't log requests, so a crash during a provider sign-in says why here. */
function logSignInFailure(cause: Cause.Cause<unknown>) {
  return Effect.logError("Sign-in through the provider failed", cause);
}

/** Sends the browser to the provider, remembering the attempt in a cookie bound to this browser. */
const toProvider = Effect.fnUntraced(function* (request: {
  readonly intent: OidcIntent;
  readonly redirect: string;
}) {
  const provider = yield* OidcSignIn;
  const incoming = yield* HttpServerRequest.HttpServerRequest;

  return yield* provider.start(request).pipe(
    Effect.flatMap(({ url, state }) =>
      HttpServerResponse.setCookie(
        // 303 so a form's POST becomes a GET at the provider.
        HttpServerResponse.redirect(url, { status: 303 }),
        oidcStateCookie,
        state,
        { ...cookieOptions(incoming), path: "/auth/oidc", maxAge: Duration.minutes(10) },
      ),
    ),
    Effect.catchTag("OidcFailure", ({ message }) => failed(request.intent, message)),
  );
});

/** Signing in through the provider, from the sign-in page. */
const oidcStart = HttpRouter.add(
  "GET",
  "/auth/oidc/start",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if ((yield* AuthSettingsStore.use((auth) => auth.mode)) !== "oidc") {
      return yield* failed("SignIn", "Signing in through a provider is off.");
    }

    return yield* toProvider({
      intent: "SignIn",
      redirect: localPath(new URL(request.url, "http://hub").searchParams.get("redirect")),
    });
  }).pipe(Effect.orDie, Effect.tapCause(logSignInFailure)),
);

/**
 * An admin's test sign-in, which turns the provider on once it works. It's a POST from the
 * dashboard, so a link on another site can't switch how everyone signs in.
 */
const oidcActivate = HttpRouter.add(
  "POST",
  "/auth/oidc/activate",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* AuthSettingsStore;
    const viewer = yield* DashboardSessions.use((sessions) =>
      sessions.viewer(request.headers),
    ).pipe(Effect.option);

    if (
      isCrossOrigin(request.headers) ||
      Option.isNone(viewer) ||
      viewerRole(viewer.value) !== "admin" ||
      auth.overridden
    ) {
      return forbidden;
    }

    return yield* toProvider({ intent: "Activate", redirect: "/settings/authentication" });
  }).pipe(Effect.orDie, Effect.tapCause(logSignInFailure)),
);

const oidcCallback = HttpRouter.add(
  "GET",
  "/auth/oidc/callback",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* AuthSettingsStore;
    const sessions = yield* DashboardSessions;
    const provider = yield* OidcSignIn;
    const state = new URL(request.url, "http://hub").searchParams.get("state");

    if (state === null || request.cookies[oidcStateCookie] !== state) {
      return yield* failed("SignIn", "That sign-in didn't start in this browser. Try again.");
    }

    const finished = yield* provider.finish({ url: request.url }).pipe(Effect.result);

    if (Result.isFailure(finished)) {
      return yield* failed(finished.failure.intent, finished.failure.message);
    }

    const { user, roleChanged, intent, redirect } = finished.success;

    if (intent === "Activate") {
      if (auth.overridden) {
        return yield* failed(intent, "FLEETFROG_AUTH_MODE on the hub keeps sign-in off.");
      }

      yield* auth.update({ ...(yield* SubscriptionRef.get(auth.settings)), mode: "oidc" });
      yield* sessions.endAll;
    } else if (roleChanged) {
      // Open sockets carry what the old role could see, so they close.
      yield* sessions.endForUser(user.id);
    }

    const token = yield* sessions.start(user.id);
    const response = yield* HttpServerResponse.setCookie(
      HttpServerResponse.redirect(redirect),
      sessionCookie,
      token,
      { ...cookieOptions(request), maxAge: sessionLifetime },
    );

    return yield* HttpServerResponse.expireCookie(response, oidcStateCookie, {
      ...cookieOptions(request),
      path: "/auth/oidc",
    });
  }).pipe(Effect.orDie, Effect.tapCause(logSignInFailure)),
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
export const AuthRoutes = Layer.mergeAll(
  session,
  login,
  logout,
  changeMode,
  oidcStart,
  oidcActivate,
  oidcCallback,
  avatars,
);
