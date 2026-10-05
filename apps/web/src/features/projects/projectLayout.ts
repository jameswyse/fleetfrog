import { summariseCheckout } from "./checkoutSummary.ts";

import type { Repository } from "@fleetfrog/protocol/domain/fleet";
import type {
  ProjectGroup,
  ProjectLayout,
  ProjectSort,
} from "@fleetfrog/protocol/domain/projectLayout";
import type { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

export type ProjectSection =
  | { readonly _tag: "Pinned" }
  | { readonly _tag: "Group"; readonly group: ProjectGroup }
  | { readonly _tag: "Owner"; readonly owner: string; readonly identity: RepositoryIdentity }
  | { readonly _tag: "Rest"; readonly title: string };

export interface ArrangedSection {
  readonly id: string;
  readonly section: ProjectSection;
  readonly repositories: ReadonlyArray<Repository>;
  readonly collapsed: boolean;
}

export interface Arrangement {
  readonly headed: boolean;
  readonly sections: ReadonlyArray<ArrangedSection>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function latestCommitAt(repository: Repository): number | null {
  const times = repository.checkouts.flatMap(({ checkout }) => {
    if (checkout.status._tag !== "Read") {
      return [];
    }

    const { lastCommit, branches } = checkout.status.git;

    return [lastCommit, ...branches.items.map(({ tip }) => tip)].flatMap((commit) =>
      commit === null ? [] : [commit.committedAt.epochMilliseconds],
    );
  });

  return times.length === 0 ? null : Math.max(...times);
}

export function attentionRank(repository: Repository): number {
  const summaries = repository.checkouts.map(({ checkout }) => summariseCheckout(checkout));

  if (
    summaries.some(
      (summary) =>
        summary._tag === "Unreadable" || summary.conflicts || summary.upstream === "gone",
    )
  ) {
    return 0;
  }

  const read = summaries.filter((summary) => summary._tag === "Read");

  if (read.some(({ hasChanges }) => hasChanges)) {
    return 1;
  }

  return read.some(({ outOfSync }) => outOfSync) ? 2 : 3;
}

const sortKeys = {
  name: () => 0,
  updated: (repository) => -(latestCommitAt(repository) ?? 0),
  attention: attentionRank,
} satisfies Record<ProjectSort, (repository: Repository) => number>;

export function sortRepositories(
  repositories: ReadonlyArray<Repository>,
  sort: ProjectSort,
): ReadonlyArray<Repository> {
  const keyOf = sortKeys[sort];
  const keys = new Map(repositories.map((repository) => [repository.key, keyOf(repository)]));

  return repositories.toSorted(
    (left, right) => (keys.get(left.key) ?? 0) - (keys.get(right.key) ?? 0),
  );
}

export function ownerOf(identity: RepositoryIdentity): string | null {
  if (identity._tag !== "Remote") {
    return null;
  }

  const slash = identity.path.lastIndexOf("/");

  return slash <= 0 ? null : identity.path.slice(0, slash);
}

function ownerSectionId(identity: RepositoryIdentity): string {
  const owner = ownerOf(identity);

  return identity._tag === "Remote" && owner !== null
    ? `owner:${identity.host.toLowerCase()}/${owner.toLowerCase()}`
    : "owner:none";
}

export function groupSectionId(group: Pick<ProjectGroup, "id">): string {
  return `group:${group.id}`;
}

export const pinnedSectionId = "pinned";

export function groupOf(
  layout: ProjectLayout,
  repository: Pick<Repository, "key">,
): ProjectGroup | null {
  return layout.groups.find(({ repositories }) => repositories.includes(repository.key)) ?? null;
}

export const restSectionId = "rest";

export function homeSectionId(
  layout: ProjectLayout,
  repository: Pick<Repository, "identity">,
): string {
  return layout.groupByOwner ? ownerSectionId(repository.identity) : restSectionId;
}

export function sectionIdOf(
  layout: ProjectLayout,
  repository: Pick<Repository, "key" | "identity">,
): string {
  if (layout.pinned.includes(repository.key)) {
    return pinnedSectionId;
  }

  const group = groupOf(layout, repository);

  if (group !== null) {
    return groupSectionId(group);
  }

  return homeSectionId(layout, repository);
}

function ownerSections(repositories: ReadonlyArray<Repository>) {
  const owners = new Map<
    string,
    { readonly section: ProjectSection; readonly repositories: Array<Repository> }
  >();

  for (const repository of repositories) {
    const id = ownerSectionId(repository.identity);
    const existing = owners.get(id);

    if (existing === undefined) {
      const owner = ownerOf(repository.identity);

      owners.set(id, {
        section:
          owner === null
            ? { _tag: "Rest", title: "No remote" }
            : { _tag: "Owner", owner, identity: repository.identity },
        repositories: [repository],
      });
    } else {
      existing.repositories.push(repository);
    }
  }

  const title = (section: ProjectSection) => (section._tag === "Owner" ? section.owner : null);

  return Array.from(owners, ([id, { section, repositories: members }]) => ({
    id,
    section,
    members,
  })).toSorted((left, right) => {
    const [leftTitle, rightTitle] = [title(left.section), title(right.section)];

    if (leftTitle === null || rightTitle === null) {
      return Number(leftTitle === null) - Number(rightTitle === null);
    }

    return collator.compare(leftTitle, rightTitle) || collator.compare(left.id, right.id);
  });
}

export function arrangeProjects(options: {
  readonly repositories: ReadonlyArray<Repository>;
  readonly layout: ProjectLayout;
  readonly matches: (repository: Repository) => boolean;
  readonly filtering: boolean;
  readonly searching: boolean;
  readonly dragging?: Repository | null;
}): Arrangement {
  const { layout } = options;
  const dragging = options.dragging ?? null;
  const pinned = new Set(layout.pinned);
  const placed = new Set<Repository["key"]>();

  const take = (predicate: (repository: Repository) => boolean) =>
    options.repositories.filter((repository) => {
      if (placed.has(repository.key) || !predicate(repository)) {
        return false;
      }

      placed.add(repository.key);

      return true;
    });

  const candidates: Array<{
    readonly id: string;
    readonly section: ProjectSection;
    readonly members: ReadonlyArray<Repository>;
  }> = [
    {
      id: pinnedSectionId,
      section: { _tag: "Pinned" },
      members: take(({ key }) => pinned.has(key)),
    },
    ...layout.groups.map((group) => {
      const keys = new Set(group.repositories);

      return {
        id: groupSectionId(group),
        section: { _tag: "Group", group } as const,
        members: take(({ key }) => keys.has(key)),
      };
    }),
  ];

  const rest = take(() => true);

  if (layout.groupByOwner) {
    const outside = dragging !== null && !rest.includes(dragging) ? [dragging] : [];

    candidates.push(
      ...ownerSections([...rest, ...outside]).map((owner) => ({
        ...owner,
        members: owner.members.filter((member) => !outside.includes(member)),
      })),
    );
  } else {
    candidates.push({
      id: restSectionId,
      section: {
        _tag: "Rest",
        title: layout.groups.length > 0 ? "Ungrouped" : "Other repositories",
      },
      members: rest,
    });
  }

  const destinations = new Set(
    dragging === null
      ? []
      : [
          ...(pinned.has(dragging.key) ? [] : [pinnedSectionId]),
          ...(sectionIdOf(layout, dragging) === homeSectionId(layout, dragging)
            ? []
            : [homeSectionId(layout, dragging)]),
        ],
  );

  const headed =
    destinations.size > 0 ||
    candidates.some(
      ({ section, members }) =>
        section._tag === "Group" || (section._tag !== "Rest" && members.length > 0),
    );

  const sections = candidates.flatMap(({ id, section, members }) => {
    const repositories = sortRepositories(members.filter(options.matches), layout.sort);
    const keepEmpty = (section._tag === "Group" && !options.filtering) || destinations.has(id);

    if (repositories.length === 0 && !keepEmpty) {
      return [];
    }

    return [
      {
        id,
        section,
        repositories,
        collapsed: headed && !options.searching && layout.collapsed.includes(id),
      },
    ];
  });

  return { headed, sections };
}

export function visibleRows(arrangement: Arrangement): ReadonlyArray<Repository> {
  return arrangement.sections.flatMap(({ repositories, collapsed }) =>
    collapsed ? [] : repositories,
  );
}

export function sectionTitle(section: ProjectSection): string {
  if (section._tag === "Pinned") {
    return "Pinned";
  }

  if (section._tag === "Group") {
    return section.group.name;
  }

  return section._tag === "Owner" ? section.owner : section.title;
}
