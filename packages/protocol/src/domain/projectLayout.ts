import { Schema } from "effect";

import { Count } from "./count.ts";
import { RepositoryKey } from "./repositoryIdentity.ts";

export const maximumProjectGroups = 100;
export const maximumGroupedRepositories = 1000;

export const ProjectGroupId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ProjectGroupId"),
);
export type ProjectGroupId = typeof ProjectGroupId.Type;

export const maximumProjectGroupNameLength = 60;

export const ProjectGroupName = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(maximumProjectGroupNameLength),
);

const RepositoryKeys = Schema.Array(RepositoryKey).check(
  Schema.isMaxLength(maximumGroupedRepositories),
);

export const ProjectGroup = Schema.Struct({
  id: ProjectGroupId,
  name: ProjectGroupName,
  repositories: RepositoryKeys,
});
export type ProjectGroup = typeof ProjectGroup.Type;

export const ProjectSort = Schema.Literals(["name", "updated", "attention"]);
export type ProjectSort = typeof ProjectSort.Type;

export const ProjectLayout = Schema.Struct({
  sort: ProjectSort,
  groupByOwner: Schema.Boolean,
  pinned: RepositoryKeys,
  groups: Schema.Array(ProjectGroup).check(Schema.isMaxLength(maximumProjectGroups)),
  collapsed: Schema.Array(Schema.String.check(Schema.isMaxLength(2048))).check(
    Schema.isMaxLength(maximumGroupedRepositories),
  ),
});
export type ProjectLayout = typeof ProjectLayout.Type;

export const defaultProjectLayout: ProjectLayout = {
  sort: "name",
  groupByOwner: false,
  pinned: [],
  groups: [],
  collapsed: [],
};

export const SavedProjectLayout = Schema.Struct({ layout: ProjectLayout, revision: Count });
export type SavedProjectLayout = typeof SavedProjectLayout.Type;

export const unsavedProjectLayout: SavedProjectLayout = {
  layout: defaultProjectLayout,
  revision: 0,
};
