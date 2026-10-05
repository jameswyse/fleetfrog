import { Effect, Schema } from "effect";

import { RepositoryKey } from "./repositoryIdentity.ts";

export const ColorScheme = Schema.Literals(["system", "light", "dark"]);
export type ColorScheme = typeof ColorScheme.Type;

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

export const Preferences = Schema.Struct({
  colorScheme: ColorScheme,
  blurPersonal: Schema.Boolean,
  projects: ProjectLayout.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultProjectLayout)),
  ),
});
export type Preferences = typeof Preferences.Type;

export const defaultPreferences: Preferences = {
  colorScheme: "system",
  blurPersonal: false,
  projects: defaultProjectLayout,
};
