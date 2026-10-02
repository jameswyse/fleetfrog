import { createFileRoute, redirect } from "@tanstack/react-router";
import { Schema } from "effect";

import { LoginPage } from "@/features/account/LoginPage.tsx";
import { isSignedOut, settledSession } from "@/rpc/session.ts";
import { localPath } from "@fleetfrog/protocol/dashboard/auth";

const LoginSearch = Schema.Struct({
  redirect: Schema.optionalKey(Schema.String),
  /** A `SignInFailure` the hub set when a sign-in through the provider didn't work. Anything else is ignored rather than refused, so an old link still opens the page. */
  failure: Schema.optionalKey(Schema.String),
});

export const Route = createFileRoute("/login")({
  validateSearch: Schema.toStandardSchemaV1(LoginSearch),
  // Someone already signed in, or sign-in is off: carry on to where they were going.
  beforeLoad: async ({ search }) => {
    if (!isSignedOut(await settledSession())) {
      throw redirect({ href: localPath(search.redirect), replace: true });
    }
  },
  component: LoginPage,
});
