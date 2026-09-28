import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { AuthenticationSettings } from "@/features/settings/access/AuthenticationSettings.tsx";

const AuthenticationSearch = Schema.Struct({
  /** Set by the hub when a test sign-in through the provider didn't work. */
  failure: Schema.optionalKey(Schema.String),
});

export const Route = createFileRoute("/_app/settings/authentication")({
  validateSearch: Schema.toStandardSchemaV1(AuthenticationSearch),
  component: AuthenticationSettings,
});
