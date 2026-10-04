import { Schema } from "effect";

export const ColorScheme = Schema.Literals(["system", "light", "dark"]);
export type ColorScheme = typeof ColorScheme.Type;

export const Preferences = Schema.Struct({
  colorScheme: ColorScheme,
  blurPersonal: Schema.Boolean,
});
export type Preferences = typeof Preferences.Type;

export const defaultPreferences: Preferences = { colorScheme: "system", blurPersonal: false };
