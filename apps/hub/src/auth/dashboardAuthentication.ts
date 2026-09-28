import { Context, Effect, Layer } from "effect";

import {
  Access,
  CurrentViewer,
  DashboardAuthentication,
  Forbidden,
  viewerRole,
} from "@fleetfrog/protocol/dashboard/rpcs";

import { DashboardSessions } from "./dashboardSessions.ts";

/** Checks the session on every call, so a role change or sign-out applies at once. */
export const DashboardAuthenticationLive = Layer.effect(DashboardAuthentication)(
  Effect.gen(function* () {
    const sessions = yield* DashboardSessions;

    return (effect, { headers, rpc }) =>
      Effect.gen(function* () {
        const viewer = yield* sessions.viewer(headers);

        if (Context.get(rpc.annotations, Access) === "admin" && viewerRole(viewer) !== "admin") {
          return yield* new Forbidden();
        }

        return yield* Effect.provideService(effect, CurrentViewer, viewer);
      });
  }),
);
