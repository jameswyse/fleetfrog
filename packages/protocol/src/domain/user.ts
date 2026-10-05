import { Schema, SchemaTransformation, Struct } from "effect";

import type { Tier } from "./action.ts";

export const UserId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const Role = Schema.Literals(["admin", "user"]);
export type Role = typeof Role.Type;

export function mayRun(role: Role, tier: Tier): boolean {
  return role === "admin" || tier === "git";
}

export const Email = Schema.Trim.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isLowercased(),
      Schema.isMaxLength(254),
      Schema.makeFilter(
        (email) => /^[^\s@\p{C}]+@[^\s@\p{C}]+$/u.test(email) || "must be an email address",
      ),
    ),
    SchemaTransformation.toLowerCase(),
  ),
  Schema.brand("Email"),
);
export type Email = typeof Email.Type;

export const DisplayName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80));

export const minimumPasswordLength = 8;

export const maximumPasswordLength = 256;

export const Password = Schema.String.check(
  Schema.isMinLength(minimumPasswordLength),
  Schema.isMaxLength(maximumPasswordLength),
);

export const PasswordAttempt = Schema.String.check(Schema.isMaxLength(maximumPasswordLength));

export const Avatar = Schema.TaggedUnion({
  Uploaded: { id: Schema.String },
  Provider: { url: Schema.String },
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
  displayNameFromProvider: Schema.Boolean,
  hasPassword: Schema.Boolean,
  linkedToProvider: Schema.Boolean,
  linkedToTailscale: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  lastSignedInAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type User = typeof User.Type;

export function isHttpUrl(url: string): boolean {
  return URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol);
}

const HttpUrl = Schema.Trim.check(
  Schema.makeFilter((url) => isHttpUrl(url) || "must be an http:// or https:// URL"),
);

const Group = Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1)));

export const OidcSettings = Schema.Struct({
  providerName: DisplayName,
  issuerUrl: HttpUrl,
  clientId: Schema.Trim.check(Schema.isMinLength(1)),
  clientSecret: Schema.String.check(Schema.isMinLength(1)),
  dashboardUrl: HttpUrl,
  adminGroup: Group,
  requiredGroup: Group,
});
export type OidcSettings = typeof OidcSettings.Type;

export const OidcInput = Schema.Struct({
  ...OidcSettings.fields,
  clientSecret: Schema.NullOr(OidcSettings.fields.clientSecret),
});
export type OidcInput = typeof OidcInput.Type;

export const OidcSummary = OidcSettings.mapFields(Struct.omit(["clientSecret"]));
export type OidcSummary = typeof OidcSummary.Type;

export const AuthSettings = Schema.Struct({
  passwords: Schema.Boolean,
  provider: Schema.Boolean,
  tailscale: Schema.Boolean,
  gravatar: Schema.Boolean,
  oidc: Schema.NullOr(OidcSettings),
});
export type AuthSettings = typeof AuthSettings.Type;

export type SignInSwitches = Pick<AuthSettings, "passwords" | "provider" | "tailscale">;

export function isSignInOn(methods: SignInSwitches): boolean {
  return methods.passwords || methods.provider || methods.tailscale;
}

export const defaultAuthSettings: AuthSettings = {
  passwords: false,
  provider: false,
  tailscale: false,
  gravatar: true,
  oidc: null,
};

export const ProviderIconSource = Schema.Literals(["provider", "uploaded"]);
export type ProviderIconSource = typeof ProviderIconSource.Type;

export const ProviderIcon = Schema.Struct({ id: Schema.String, source: ProviderIconSource });
export type ProviderIcon = typeof ProviderIcon.Type;

export const AuthSettingsView = Schema.Struct({
  passwords: Schema.Boolean,
  provider: Schema.Boolean,
  tailscale: Schema.Boolean,
  tailscaleAvailable: Schema.Boolean,
  overridden: Schema.Boolean,
  gravatar: Schema.Boolean,
  oidc: Schema.NullOr(OidcSummary),
  icon: Schema.NullOr(ProviderIcon),
});
export type AuthSettingsView = typeof AuthSettingsView.Type;
