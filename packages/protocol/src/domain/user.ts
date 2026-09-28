import { Schema, SchemaTransformation, Struct } from "effect";

import { actionTiers } from "./action.ts";

import type { ActionKind } from "./action.ts";

export const UserId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

/** Admins can use everything. Users can't use Cleanup, cleanup actions or Settings. */
export const Role = Schema.Literals(["admin", "user"]);
export type Role = typeof Role.Type;

/** Users can run `git`-tier actions. Cleanup and anything newer is for admins. */
export function mayRun(role: Role, kind: ActionKind): boolean {
  return role === "admin" || actionTiers[kind] === "git";
}

/** Emails are compared without case, so they're stored lowercased. */
export const Email = Schema.Trim.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isLowercased(),
      Schema.makeFilter((email) => /^[^\s@]+@[^\s@]+$/.test(email) || "must be an email address"),
    ),
    SchemaTransformation.toLowerCase(),
  ),
  Schema.brand("Email"),
);
export type Email = typeof Email.Type;

export const DisplayName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80));

export const minimumPasswordLength = 8;

/** The upper bound keeps hashing cheap for anyone sending a huge password. */
export const Password = Schema.String.check(
  Schema.isMinLength(minimumPasswordLength),
  Schema.isMaxLength(256),
);

/** Where a user's picture comes from. Any of them can fail to load, leaving their initials. */
export const Avatar = Schema.TaggedUnion({
  /** Uploaded to the hub, served from `/avatars/:id`. */
  Uploaded: { id: Schema.String },
  /** The `picture` claim from the sign-in provider. */
  Provider: { url: Schema.String },
  /** The SHA-256 of the user's email, for Gravatar to look up. */
  Gravatar: { hash: Schema.String },
  None: {},
});
export type Avatar = typeof Avatar.Type;

export const avatarMediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export const AvatarMediaType = Schema.Literals(avatarMediaTypes);
export type AvatarMediaType = typeof AvatarMediaType.Type;
export const maximumAvatarBytes = 512 * 1024;

export const User = Schema.Struct({
  id: UserId,
  email: Schema.String,
  displayName: Schema.String,
  role: Role,
  avatar: Avatar,
  /** The sign-in provider sets the name on every sign-in, so the user can't change it. */
  displayNameFromProvider: Schema.Boolean,
  hasPassword: Schema.Boolean,
  /** Whether the user has signed in through the provider, which ties them to its account. */
  linkedToProvider: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  lastSignedInAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type User = typeof User.Type;

const HttpUrl = Schema.Trim.check(
  Schema.makeFilter(
    (url) =>
      (URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol)) ||
      "must be an http:// or https:// URL",
  ),
);

const Group = Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1)));

/** An OpenID Connect provider such as Authentik, as the admin configured it. */
export const OidcSettings = Schema.Struct({
  /** Shown on the sign-in button, such as "Authentik". */
  providerName: DisplayName,
  issuerUrl: HttpUrl,
  clientId: Schema.Trim.check(Schema.isMinLength(1)),
  clientSecret: Schema.String.check(Schema.isMinLength(1)),
  /** Where people open the dashboard, which the provider sends them back to. */
  dashboardUrl: HttpUrl,
  /** Members of this group are admins and everyone else is a user, decided on every sign-in. */
  adminGroup: Group,
  /** When set, only members of this group can sign in. */
  requiredGroup: Group,
});
export type OidcSettings = typeof OidcSettings.Type;

/** The provider's settings as an admin saves them. A null client secret keeps the saved one. */
export const OidcInput = Schema.Struct({
  ...OidcSettings.fields,
  clientSecret: Schema.NullOr(OidcSettings.fields.clientSecret),
});
export type OidcInput = typeof OidcInput.Type;

/** The provider's settings as admins see them. The client secret never leaves the hub. */
export const OidcSummary = OidcSettings.mapFields(Struct.omit(["clientSecret"]));
export type OidcSummary = typeof OidcSummary.Type;

/**
 * The hub's sign-in settings as stored. Each way of signing in is on or off by itself; with both
 * off, sign-in is off and anyone who can reach the dashboard is an admin.
 */
export const AuthSettings = Schema.Struct({
  passwords: Schema.Boolean,
  /** Signing in through the OpenID Connect provider in `oidc`. */
  provider: Schema.Boolean,
  /** Whether users without a picture get their Gravatar, which their browsers fetch from Gravatar. */
  gravatar: Schema.Boolean,
  oidc: Schema.NullOr(OidcSettings),
});
export type AuthSettings = typeof AuthSettings.Type;

export const defaultAuthSettings: AuthSettings = {
  passwords: false,
  provider: false,
  gravatar: true,
  oidc: null,
};

/** Where the provider's sign-in button icon came from. */
export const ProviderIconSource = Schema.Literals(["provider", "uploaded"]);
export type ProviderIconSource = typeof ProviderIconSource.Type;

/** The sign-in button's icon, served from `/auth/provider-icon/:id`. */
export const ProviderIcon = Schema.Struct({ id: Schema.String, source: ProviderIconSource });
export type ProviderIcon = typeof ProviderIcon.Type;

/** The sign-in settings as admins see them. */
export const AuthSettingsView = Schema.Struct({
  passwords: Schema.Boolean,
  provider: Schema.Boolean,
  /** `FLEETFROG_AUTH_MODE` on the hub keeps sign-in off whatever the settings say. */
  overridden: Schema.Boolean,
  gravatar: Schema.Boolean,
  oidc: Schema.NullOr(OidcSummary),
  icon: Schema.NullOr(ProviderIcon),
});
export type AuthSettingsView = typeof AuthSettingsView.Type;
