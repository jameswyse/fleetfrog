import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { OidcSettings } from "@/features/settings/access/OidcSettings.tsx";

const OidcSearch = Schema.Struct({
  /** Set when an admin turned OpenID Connect on before it was set up, so saving turns it on. */
  enable: Schema.optionalKey(Schema.Boolean),
});

export const Route = createFileRoute("/_app/settings/authentication/oidc")({
  validateSearch: Schema.toStandardSchemaV1(OidcSearch),
  component: OidcSettings,
});
