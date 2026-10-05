import { Duration, Effect, Layer, Option, Result, Schema, SubscriptionRef } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  localPath,
  LoginFailure,
  LoginRequest,
  MethodChange,
  Session,
} from "@fleetfrog/protocol/dashboard/auth";
import { viewerRole } from "@fleetfrog/protocol/dashboard/rpcs";
import { Email, isSignInOn } from "@fleetfrog/protocol/domain/user";

import { isCrossOrigin } from "../http/sameOrigin.ts";
import { clientAddress, tailscaleIdentity } from "../http/serveSocket.ts";
import { HubConfig } from "../hubConfig.ts";
import { PreferencesStore } from "../settings/preferencesStore.ts";
import { ProjectLayoutStore } from "../settings/projectLayoutStore.ts";
import { AuthSettingsStore } from "./authSettingsStore.ts";
import { DashboardSessions, sessionCookie, sessionLifetime } from "./dashboardSessions.ts";
import { LoginThrottle } from "./loginThrottle.ts";
import { OidcSignIn } from "./oidcSignIn.ts";
import { checkPassword, hashPassword } from "./passwords.ts";
import { ProviderIconStore } from "./providerIcon.ts";
import { UserStore } from "./userStore.ts";

import type { Cause } from "effect";

import type { SignInMethods } from "@fleetfrog/protocol/dashboard/auth";
import type { AuthSettings, SignInSwitches, UserId } from "@fleetfrog/protocol/domain/user";

import type { OidcFailure, OidcIntent } from "./oidcSignIn.ts";
import type { UserRecord } from "./userStore.ts";

const sessionJson = HttpServerResponse.schemaJson(Schema.toCodecJson(Session));
const failureJson = HttpServerResponse.schemaJson(Schema.toCodecJson(LoginFailure));

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
const decodeEmail = Schema.decodeUnknownOption(Email);

const describeSession = Effect.fnUntraced(function* (userId: UserId | null) {
  const auth = yield* AuthSettingsStore;
  const preferences = yield* PreferencesStore;
  const projectLayouts = yield* ProjectLayoutStore;
  const users = yield* UserStore;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const { oidc } = yield* SubscriptionRef.get(auth.settings);
  const icon = yield* ProviderIconStore.use((icons) => SubscriptionRef.get(icons.current));
  const { passwords, provider, tailscale } = yield* auth.methods;

  if (!isSignInOn({ passwords, provider, tailscale })) {
    return Session.cases.Open.make({
      preferences: yield* preferences.get(null),
      projectLayout: yield* projectLayouts.get(null),
    });
  }

  const methods: SignInMethods = {
    passwords,
    provider:
      provider && oidc !== null ? { name: oidc.providerName, icon: icon?.id ?? null } : null,
    tailscale: tailscale ? { identity: Option.getOrNull(tailscaleIdentity(request)) } : null,
  };

  if (userId === null) {
    return Session.cases.SignedOut.make({ methods });
  }

  const user = yield* users.find(userId).pipe(Effect.flatMap(users.describe), Effect.orDie);

  return Session.cases.SignedIn.make({
    methods,
    user,
    preferences: yield* preferences.get(userId),
    projectLayout: yield* projectLayouts.get(userId),
  });
});

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

    if (isCrossOrigin(request)) {
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
    const attempt = { email, address: Option.getOrElse(clientAddress(request), () => "") };
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

    if (isCrossOrigin(request)) {
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

function refuse(reason: string) {
  return HttpServerResponse.text(reason, { status: 409 });
}

const tailnetAccount = Effect.fnUntraced(function* (options: { readonly admin: boolean }) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const identity = tailscaleIdentity(request);

  if (Option.isNone(identity)) {
    return Result.fail(
      "Open the dashboard at its Tailscale address, on a device signed in to Tailscale as you.",
    );
  }

  const { name } = identity.value;
  const tailnetLogin = identity.value.login;
  const email = decodeEmail(tailnetLogin);

  if (Option.isNone(email)) {
    return Result.fail(
      `Your Tailscale login, ${tailnetLogin}, isn't an email address, which FleetFrog needs.`,
    );
  }

  return yield* UserStore.use((users) =>
    users.signInFromTailscale({
      login: tailnetLogin,
      email: email.value,
      name,
      admin: options.admin,
    }),
  ).pipe(
    Effect.map((account) => Result.succeed(account)),
    Effect.catchTag("EmailTaken", () =>
      Effect.succeed(
        Result.fail(
          `Another FleetFrog user has ${email.value} as their email and signs in through another Tailscale login.`,
        ),
      ),
    ),
  );
});

const tailscaleSignIn = HttpRouter.add(
  "POST",
  "/auth/tailscale",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (isCrossOrigin(request)) {
      return forbidden;
    }

    if (!(yield* AuthSettingsStore.use((auth) => auth.methods)).tailscale) {
      return refuse("Tailscale sign-in is off.");
    }

    const account = yield* tailnetAccount({ admin: false });

    return Result.isFailure(account) ? refuse(account.failure) : yield* signIn(account.success.id);
  }).pipe(Effect.orDie),
);

const noOtherWayIn = "Turn on another way of signing in first, or turn sign-in off.";

function lockoutReason(
  settings: AuthSettings,
  self: UserRecord,
  method: keyof SignInSwitches,
  { tailscaleAvailable }: { readonly tailscaleAvailable: boolean },
): string | null {
  const providerName = settings.oidc?.providerName ?? "the provider";

  const others = [
    {
      method: "passwords",
      on: settings.passwords,
      usable: self.passwordHash !== null,
      fix: "set yourself a password under Users",
    },
    {
      method: "provider",
      on: settings.provider,
      usable: self.oidc !== null,
      fix: `sign in through ${providerName} once`,
    },
    {
      method: "tailscale",
      on: settings.tailscale && tailscaleAvailable,
      usable: self.tailscaleLogin !== null,
      fix: "sign in through Tailscale once",
    },
  ].filter((other) => other.method !== method && other.on);

  if (others.length === 0) {
    return noOtherWayIn;
  }

  if (others.some((other) => other.usable)) {
    return null;
  }

  const without = { passwords: "a password", provider: providerName, tailscale: "Tailscale" }[
    method
  ];

  return `You couldn't sign in again without ${without}. First, ${others.map((other) => other.fix).join(", or ")}.`;
}

const changeMethods = HttpRouter.add(
  "POST",
  "/auth/methods",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* AuthSettingsStore;
    const users = yield* UserStore;
    const sessions = yield* DashboardSessions;
    const config = yield* HubConfig;

    if (isCrossOrigin(request)) {
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
    const wasOn = isSignInOn(settings);
    const providerName = settings.oidc?.providerName ?? "the provider";
    const signedIn = viewer.value._tag === "SignedIn" ? viewer.value : null;
    const self = signedIn === null ? null : yield* users.find(signedIn.userId).pipe(Effect.orDie);
    const current = describeSession(signedIn?.userId ?? null).pipe(Effect.flatMap(sessionJson));

    const turnOff = (method: keyof SignInSwitches) =>
      Effect.gen(function* () {
        if (signedIn === null || self === null) {
          return refuse(noOtherWayIn);
        }

        const lockout = lockoutReason(settings, self, method, {
          tailscaleAvailable: config.dashboardSocket !== null,
        });

        if (lockout !== null) {
          return refuse(lockout);
        }

        yield* auth.update({ ...settings, [method]: false });
        yield* sessions.endOthers(signedIn.sessionHash);

        return yield* current;
      });

    switch (change._tag) {
      case "TurnOff": {
        yield* auth.update({ ...settings, passwords: false, provider: false, tailscale: false });
        yield* sessions.endAll;

        return yield* HttpServerResponse.expireCookie(
          yield* sessionJson(yield* describeSession(null)),
          sessionCookie,
          cookieOptions(request),
        );
      }

      case "EnablePasswords": {
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

        yield* sessions.endAll;

        return yield* signIn(userId);
      }

      case "DisablePasswords":
        return yield* turnOff("passwords");

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

      case "DisableProvider":
        return yield* turnOff("provider");

      case "EnableTailscale": {
        if (config.dashboardSocket === null) {
          return refuse(
            "Tailscale Serve doesn't front the hub, so it can't tell who's on your tailnet.",
          );
        }

        const account = yield* tailnetAccount({ admin: true });

        if (Result.isFailure(account)) {
          return refuse(account.failure);
        }

        yield* auth.update({ ...settings, tailscale: true });

        if (!wasOn) {
          yield* sessions.endAll;
        }

        return yield* signIn(account.success.id);
      }

      case "DisableTailscale":
        return yield* turnOff("tailscale");

      default: {
        const unknown: never = change;

        return unknown;
      }
    }
  }).pipe(Effect.orDie),
);

const oidcStateCookie = "fleetfrog_oidc_state";

function failed({ intent, kind, detail }: Pick<OidcFailure, "intent" | "kind" | "detail">) {
  const page = intent === "Activate" ? "/settings/authentication" : "/login";

  return Effect.logWarning("Sign-in through the provider didn't work").pipe(
    Effect.annotateLogs({ intent, kind, reason: detail }),
    Effect.as(
      HttpServerResponse.redirect(`${page}?${new URLSearchParams({ failure: kind }).toString()}`),
    ),
  );
}

function logSignInFailure(cause: Cause.Cause<unknown>) {
  return Effect.logError("Sign-in through the provider failed", cause);
}

const toProvider = Effect.fnUntraced(function* (request: {
  readonly intent: OidcIntent;
  readonly redirect: string;
}) {
  const provider = yield* OidcSignIn;
  const incoming = yield* HttpServerRequest.HttpServerRequest;

  return yield* provider.start(request).pipe(
    Effect.flatMap(({ url, state }) =>
      HttpServerResponse.setCookie(
        HttpServerResponse.redirect(url, { status: 303 }),
        oidcStateCookie,
        state,
        { ...cookieOptions(incoming), path: "/auth/oidc", maxAge: Duration.minutes(10) },
      ),
    ),
    Effect.catchTag("OidcFailure", failed),
  );
});

const oidcStart = HttpRouter.add(
  "GET",
  "/auth/oidc/start",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (!(yield* AuthSettingsStore.use((auth) => auth.methods)).provider) {
      return yield* failed({
        intent: "SignIn",
        kind: "ProviderOff",
        detail: "Signing in through a provider is off.",
      });
    }

    return yield* toProvider({
      intent: "SignIn",
      redirect: localPath(new URL(request.url, "http://hub").searchParams.get("redirect")),
    });
  }).pipe(Effect.orDie, Effect.tapCause(logSignInFailure)),
);

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
      isCrossOrigin(request) ||
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
      return yield* failed({
        intent: "SignIn",
        kind: "OtherBrowser",
        detail: "The state cookie didn't match the callback's state.",
      });
    }

    const finished = yield* provider.finish({ url: request.url }).pipe(Effect.result);

    if (Result.isFailure(finished)) {
      return yield* failed(finished.failure);
    }

    const { user, roleChanged, intent, redirect } = finished.success;

    if (intent === "Activate") {
      if (auth.overridden) {
        return yield* failed({
          intent,
          kind: "SignInOff",
          detail: "FLEETFROG_AUTH_MODE on the hub keeps sign-in off.",
        });
      }

      const settings = yield* SubscriptionRef.get(auth.settings);

      yield* auth.update({ ...settings, provider: true });

      if (!isSignInOn(settings)) {
        yield* sessions.endAll;
      }
    } else if (roleChanged) {
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

export const AuthRoutes = Layer.mergeAll(
  session,
  login,
  logout,
  tailscaleSignIn,
  changeMethods,
  oidcStart,
  oidcActivate,
  oidcCallback,
  providerIcon,
  avatars,
);
