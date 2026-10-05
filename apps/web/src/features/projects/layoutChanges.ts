import { groupSectionId } from "./projectLayout.ts";

import type {
  ProjectGroup,
  ProjectGroupId,
  ProjectLayout,
} from "@fleetfrog/protocol/domain/preferences";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

export function setPinned(
  layout: ProjectLayout,
  repository: RepositoryKey,
  pinned: boolean,
): ProjectLayout {
  const others = layout.pinned.filter((key) => key !== repository);

  return { ...layout, pinned: pinned ? [...others, repository] : others };
}

export function saveGroup(layout: ProjectLayout, saved: ProjectGroup): ProjectLayout {
  const members = new Set(saved.repositories);

  const groups = layout.groups.map((group) =>
    group.id === saved.id
      ? saved
      : { ...group, repositories: group.repositories.filter((key) => !members.has(key)) },
  );

  return {
    ...layout,
    groups: groups.some(({ id }) => id === saved.id) ? groups : [...groups, saved],
  };
}

export function moveToGroup(
  layout: ProjectLayout,
  repository: RepositoryKey,
  groupId: ProjectGroupId | null,
): ProjectLayout {
  return {
    ...layout,
    groups: layout.groups.map((group) => {
      const others = group.repositories.filter((key) => key !== repository);

      return { ...group, repositories: group.id === groupId ? [...others, repository] : others };
    }),
  };
}

export function deleteGroup(layout: ProjectLayout, groupId: ProjectGroupId): ProjectLayout {
  const sectionId = groupSectionId({ id: groupId });

  return {
    ...layout,
    groups: layout.groups.filter(({ id }) => id !== groupId),
    collapsed: layout.collapsed.filter((id) => id !== sectionId),
  };
}

export function moveGroup(
  layout: ProjectLayout,
  groupId: ProjectGroupId,
  offset: -1 | 1,
): ProjectLayout {
  const from = layout.groups.findIndex(({ id }) => id === groupId);
  const to = from + offset;
  const moving = layout.groups[from];

  if (moving === undefined || to < 0 || to >= layout.groups.length) {
    return layout;
  }

  const groups = layout.groups.toSpliced(from, 1).toSpliced(to, 0, moving);

  return { ...layout, groups };
}

export function setCollapsed(
  layout: ProjectLayout,
  sectionId: string,
  collapsed: boolean,
): ProjectLayout {
  const others = layout.collapsed.filter((id) => id !== sectionId);

  return { ...layout, collapsed: collapsed ? [...others, sectionId] : others };
}
