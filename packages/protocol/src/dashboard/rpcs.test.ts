import { expect, it } from "@effect/vitest";
import { Context } from "effect";

import { Access, DashboardRpcs } from "./rpcs.ts";

it("opens only the agreed RPCs to users, leaving every other one to admins", () => {
  const forUsers = [...DashboardRpcs.requests.values()]
    .flatMap((rpc) => (Context.get(rpc.annotations, Access) === "user" ? [rpc._tag] : []))
    .toSorted();

  expect(forUsers).toEqual([
    "Cancel",
    "ChangePassword",
    "Refresh",
    "SetAvatar",
    "SetPreferences",
    "SetProjectLayout",
    "StartBatch",
    "UpdateProfile",
    "WatchActivity",
    "WatchBatch",
    "WatchFleet",
    "WatchRuns",
  ]);
});
