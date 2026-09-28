import { createFileRoute, redirect } from "@tanstack/react-router";
import { Schema } from "effect";

import { LoginPage, safeRedirect } from "@/features/account/LoginPage.tsx";
import { isSignedOut, settledSession } from "@/rpc/session.ts";

const LoginSearch = Schema.Struct({
  redirect: Schema.optionalKey(Schema.String),
  /** Set by the hub when a sign-in through the provider didn't work. */
  failure: Schema.optionalKey(Schema.String),
});

export const Route = createFileRoute("/login")({
  validateSearch: Schema.toStandardSchemaV1(LoginSearch),
  // Someone already signed in, or sign-in is off: carry on to where they were going.
  beforeLoad: async ({ search }) => {
    if (!isSignedOut(await settledSession())) {
      throw redirect({ href: safeRedirect(search.redirect), replace: true });
    }
  },
  component: LoginPage,
});
