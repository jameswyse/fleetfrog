import { groupSectionId, sectionIdOf } from "./projectLayout.ts";

import type { Repository } from "@fleetfrog/protocol/domain/fleet";
import type {
  ProjectGroup,
  ProjectGroupId,
  ProjectLayout,
} from "@fleetfrog/protocol/domain/projectLayout";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { ProjectSection } from "./projectLayout.ts";

export function setPinned(
  layout: ProjectLayout,
  repository: RepositoryKey,
  pinned: boolean,
): ProjectLayout {
  const others = layout.pinned.filter((key) => key !== repository);

  return { ...layout, pinned: pinned ? [...others, repository] : others };
}

export interface GroupEdit {
  readonly id: ProjectGroupId;
  readonly name: string;
  readonly members: ReadonlyArray<RepositoryKey>;
  readonly added: ReadonlyArray<RepositoryKey>;
  readonly removed: ReadonlyArray<RepositoryKey>;
}

export function editGroup(layout: ProjectLayout, edit: GroupEdit): ProjectLayout {
  const existing = layout.groups.find(({ id }) => id === edit.id);
  const removed = new Set(edit.removed);

  const repositories =
    existing === undefined
      ? edit.members
      : [
          ...existing.repositories.filter((key) => !removed.has(key)),
          ...edit.added.filter((key) => !existing.repositories.includes(key)),
        ];

  const claimed = new Set(repositories);
  const saved: ProjectGroup = { id: edit.id, name: edit.name, repositories };

  const others = layout.groups.map((group) =>
    group.id === edit.id
      ? saved
      : { ...group, repositories: group.repositories.filter((key) => !claimed.has(key)) },
  );

  return { ...layout, groups: existing === undefined ? [...others, saved] : others };
}

export function moveToGroup(
  layout: ProjectLayout,
  repository: RepositoryKey,
  groupId: ProjectGroupId | null,
): ProjectLayout {
  if (groupId !== null && !layout.groups.some(({ id }) => id === groupId)) {
    return layout;
  }

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

export function placeGroup(
  layout: ProjectLayout,
  groupId: ProjectGroupId,
  placement: { readonly side: "Before" | "After"; readonly targetId: ProjectGroupId },
): ProjectLayout {
  const moving = layout.groups.find(({ id }) => id === groupId);
  const others = layout.groups.filter(({ id }) => id !== groupId);
  const target = others.findIndex(({ id }) => id === placement.targetId);

  if (moving === undefined || target === -1) {
    return layout;
  }

  const at = placement.side === "Before" ? target : target + 1;

  return { ...layout, groups: others.toSpliced(at, 0, moving) };
}

export function dropRepository(
  layout: ProjectLayout,
  repository: Pick<Repository, "key" | "identity">,
  target: { readonly id: string; readonly section: ProjectSection },
): ProjectLayout | null {
  if (sectionIdOf(layout, repository) === target.id) {
    return null;
  }

  const { section } = target;

  if (section._tag === "Pinned") {
    return setPinned(layout, repository.key, true);
  }

  const unpinned = setPinned(layout, repository.key, false);

  if (section._tag === "Group") {
    const { id } = section.group;

    return layout.groups.some((group) => group.id === id)
      ? moveToGroup(unpinned, repository.key, id)
      : null;
  }

  const ungrouped = moveToGroup(unpinned, repository.key, null);

  return sectionIdOf(ungrouped, repository) === target.id ? ungrouped : null;
}

export function setCollapsed(
  layout: ProjectLayout,
  sectionId: string,
  collapsed: boolean,
): ProjectLayout {
  const others = layout.collapsed.filter((id) => id !== sectionId);

  return { ...layout, collapsed: collapsed ? [...others, sectionId] : others };
}
