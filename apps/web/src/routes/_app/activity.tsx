import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { ActivityPage } from "@/features/activity/ActivityPage.tsx";
import { OutcomeKind } from "@fleetfrog/protocol/domain/action";
import { BatchId } from "@fleetfrog/protocol/domain/activity";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

const ActivitySearch = Schema.Struct({
  machine: Schema.optionalKey(MachineId),
  repository: Schema.optionalKey(RepositoryKey),
  outcome: Schema.optionalKey(OutcomeKind),
  /** The batch open in the detail panel. */
  batch: Schema.optionalKey(BatchId),
});

export const Route = createFileRoute("/_app/activity")({
  validateSearch: Schema.toStandardSchemaV1(ActivitySearch),
  component: ActivityPage,
});
