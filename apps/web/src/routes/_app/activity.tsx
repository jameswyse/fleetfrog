import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { ActivityLayout } from "@/features/activity/ActivityLayout.tsx";
import { OutcomeKind } from "@fleetfrog/protocol/domain/action";
import { BatchId } from "@fleetfrog/protocol/domain/activity";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

const ActivitySearch = Schema.Struct({
  machines: Schema.optionalKey(Schema.Array(MachineId)),
  repositories: Schema.optionalKey(Schema.Array(RepositoryKey)),
  outcomes: Schema.optionalKey(Schema.Array(OutcomeKind)),
  batch: Schema.optionalKey(BatchId),
});

export const Route = createFileRoute("/_app/activity")({
  validateSearch: Schema.toStandardSchemaV1(ActivitySearch),
  component: ActivityLayout,
});
