import { createFileRoute, redirect } from "@tanstack/react-router";
import { Schema } from "effect";

import { LoginPage } from "@/features/account/LoginPage.tsx";
import { isSignedOut, settledSession } from "@/rpc/session.ts";
import { localPath } from "@fleetfrog/protocol/dashboard/auth";

const LoginSearch = Schema.Struct({
  redirect: Schema.optionalKey(Schema.String),
  failure: Schema.optionalKey(Schema.String),
});

export const Route = createFileRoute("/login")({
  validateSearch: Schema.toStandardSchemaV1(LoginSearch),
  beforeLoad: async ({ search }) => {
    if (!isSignedOut(await settledSession())) {
      throw redirect({ href: localPath(search.redirect), replace: true });
    }
  },
  component: LoginPage,
});
