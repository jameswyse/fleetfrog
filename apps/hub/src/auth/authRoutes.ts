import { Duration, Effect, Layer, Option, Result, Schema, SubscriptionRef } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  localPath,
  LoginFailure,
  LoginRequest,
  MethodChange,
  Session,
} from "@fleetfrog/protocol/dashboard/auth";
import { viewerRole } from "@fleetfrog/protocol/dashboard/rpcs";

import { isCrossOrigin } from "../http/sameOrigin.ts";
import { AuthSettingsStore } from "./authSettingsStore.ts";
import { DashboardSessions, sessionCookie, sessionLifetime } from "./dashboardSessions.ts";
import { LoginThrottle } from "./loginThrottle.ts";
import { OidcSignIn } from "./oidcSignIn.ts";
import { checkPassword, hashPassword } from "./passwords.ts";
import { ProviderIconStore } from "./providerIcon.ts";
import { UserStore } from "./userStore.ts";

import type { Cause } from "effect";

import type { SignInMethods } from "@fleetfrog/protocol/dashboard/auth";
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
  const icon = yield* ProviderIconStore.use((icons) => SubscriptionRef.get(icons.current));
  const { passwords, provider } = yield* auth.methods;

  if (!passwords && !provider) {
    return Session.cases.Open.make({});
  }

  const methods: SignInMethods = {
    passwords,
    provider:
      provider && oidc !== null ? { name: oidc.providerName, icon: icon?.id ?? null } : null,
  };

  if (userId === null) {
    return Session.cases.SignedOut.make({ methods });
  }

  const user = yield* users.find(userId).pipe(Effect.flatMap(users.describe), Effect.orDie);

  return Session.cases.SignedIn.make({ methods, user });
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

    if (!(yield* auth.methods).passwords) {
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

/** Why a change to how people sign in was refused, for the admin who asked. */
function refuse(reason: string) {
  return HttpServerResponse.text(reason, { status: 409 });
}

const changeMethods = HttpRouter.add(
  "POST",
  "/auth/methods",
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
      return refuse("FLEETFROG_AUTH_MODE on the hub keeps sign-in off. Remove it to choose here.");
    }

    const body = yield* HttpServerRequest.schemaBodyJson(MethodChange).pipe(Effect.option);

    if (Option.isNone(body)) {
      return HttpServerResponse.text("Expected a change to how people sign in.", { status: 400 });
    }

    const settings = yield* SubscriptionRef.get(auth.settings);
    const change = body.value;
    const wasOn = settings.passwords || settings.provider;
    const providerName = settings.oidc?.providerName ?? "the provider";
    // With sign-in on, only a signed-in admin gets this far.
    const signedIn = viewer.value._tag === "SignedIn" ? viewer.value : null;
    const self = signedIn === null ? null : yield* users.find(signedIn.userId).pipe(Effect.orDie);
    // The session as it is after the change.
    const current = describeSession(signedIn?.userId ?? null).pipe(Effect.flatMap(sessionJson));

    switch (change._tag) {
      case "TurnOff": {
        yield* auth.update({ ...settings, passwords: false, provider: false });
        yield* sessions.endAll;

        return yield* HttpServerResponse.expireCookie(
          yield* sessionJson(Session.cases.Open.make({})),
          sessionCookie,
          cookieOptions(request),
        );
      }

      case "EnablePasswords": {
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

        yield* auth.update({ ...settings, passwords: true });

        if (wasOn) {
          return yield* current;
        }

        // Everyone using the dashboard with sign-in off now has to sign in.
        yield* sessions.endAll;

        return yield* signIn(userId);
      }

      case "DisablePasswords": {
        if (!settings.provider || signedIn === null) {
          return refuse(`Turn on ${providerName} first, or turn sign-in off.`);
        }

        if (self?.oidc === null) {
          return refuse(
            `Sign in through ${providerName} once first, so you can still sign in without a password.`,
          );
        }

        yield* auth.update({ ...settings, passwords: false });
        yield* sessions.endOthers(signedIn.sessionHash);

        return yield* current;
      }

      case "EnableProvider": {
        if (settings.oidc === null) {
          return refuse("Set up OpenID Connect first.");
        }

        if (!wasOn) {
          return refuse(`With sign-in off, turn it on by signing in through ${providerName}.`);
        }

        yield* auth.update({ ...settings, provider: true });

        return yield* current;
      }

      case "DisableProvider": {
        if (!settings.passwords || signedIn === null) {
          return refuse("Turn on passwords first, or turn sign-in off.");
        }

        if (self?.passwordHash === null) {
          return refuse(
            "Your account has no password, so you couldn't sign in. Set yourself one under Users first.",
          );
        }

        yield* auth.update({ ...settings, provider: false });
        yield* sessions.endOthers(signedIn.sessionHash);

        return yield* current;
      }

      default: {
        const unknown: never = change;

        return unknown;
      }
    }
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

    if (!(yield* AuthSettingsStore.use((auth) => auth.methods)).provider) {
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

      const settings = yield* SubscriptionRef.get(auth.settings);

      yield* auth.update({ ...settings, provider: true });

      // With sign-in off until now, everyone using the dashboard has to sign in.
      if (!settings.passwords && !settings.provider) {
        yield* sessions.endAll;
      }
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

/**
 * The provider's sign-in button icon by the hash of its bytes, so browsers keep it for good. It
 * shows on the sign-in page, so it's public. An SVG is sandboxed and never runs a script.
 */
const providerIcon = HttpRouter.add(
  "GET",
  "/auth/provider-icon/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const icon =
      id === undefined ? Option.none() : yield* ProviderIconStore.use((store) => store.find(id));

    return Option.match(icon, {
      onNone: () => HttpServerResponse.text("No such icon.", { status: 404 }),
      onSome: ({ mediaType, data }) =>
        HttpServerResponse.uint8Array(data, {
          contentType: mediaType,
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
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
  changeMethods,
  oidcStart,
  oidcActivate,
  oidcCallback,
  providerIcon,
  avatars,
);
