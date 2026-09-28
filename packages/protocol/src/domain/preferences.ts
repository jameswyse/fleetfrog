import { Schema } from "effect";

export const ColorScheme = Schema.Literals(["system", "light", "dark"]);
export type ColorScheme = typeof ColorScheme.Type;

/**
 * How the dashboard looks to one user, or to everyone while sign-in is off. The hub keeps them, and
 * each browser keeps a copy to apply before the hub answers.
 */
export const Preferences = Schema.Struct({
  colorScheme: ColorScheme,
  /** Blurs email addresses, and usernames from other services, for people who share their screen. */
  blurPersonal: Schema.Boolean,
});
export type Preferences = typeof Preferences.Type;

export const defaultPreferences: Preferences = { colorScheme: "system", blurPersonal: false };
