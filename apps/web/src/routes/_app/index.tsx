import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { ProjectsPage } from "@/features/projects/ProjectsPage.tsx";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

const ProjectsSearch = Schema.Struct({
  filter: Schema.optionalKey(Schema.Literals(["changes", "out-of-sync"])),
  q: Schema.optionalKey(Schema.String),
  /** The repository open in the side panel. */
  repo: Schema.optionalKey(RepositoryKey),
  /** With `repo`, the machine whose checkouts the panel shows. */
  machine: Schema.optionalKey(MachineId),
  /** With `repo` and `machine`, the checkout shown when the machine has several. */
  path: Schema.optionalKey(Schema.String),
});

export const Route = createFileRoute("/_app/")({
  validateSearch: Schema.toStandardSchemaV1(ProjectsSearch),
  component: ProjectsPage,
});
