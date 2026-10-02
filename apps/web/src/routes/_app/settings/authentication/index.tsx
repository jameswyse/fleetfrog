import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { AuthenticationSettings } from "@/features/settings/access/AuthenticationSettings.tsx";

const AuthenticationSearch = Schema.Struct({
  /** A `SignInFailure` the hub set when a test sign-in through the provider didn't work. Anything else is ignored rather than refused, so an old link still opens the page. */
  failure: Schema.optionalKey(Schema.String),
});

export const Route = createFileRoute("/_app/settings/authentication/")({
  validateSearch: Schema.toStandardSchemaV1(AuthenticationSearch),
  component: AuthenticationSettings,
});
