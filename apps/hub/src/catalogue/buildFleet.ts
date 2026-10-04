import { DateTime } from "effect";

import { Connection } from "@fleetfrog/protocol/domain/fleet";
import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { AgentUpdate } from "@fleetfrog/protocol/domain/agentUpdate";
import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { PollingSettings } from "@fleetfrog/protocol/domain/polling";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";
import type { IntegrationSettings, T3CodeProject } from "@fleetfrog/protocol/domain/t3Code";

import type { OnlineAgent } from "../agents/agentSessions.ts";
import type { MachineRecord } from "../machines/machineStore.ts";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

type CheckoutGroup = [MachineCheckout, ...Array<MachineCheckout>];

/** The remote's repository name, or the most common main-worktree directory name for local-only repositories. */
function repositoryName(checkouts: CheckoutGroup): string {
  const { identity } = checkouts[0].checkout;

  if (identity._tag === "Remote") {
    return identity.path.split("/").at(-1) ?? identity.path;
  }

  const counts = new Map<string, number>();

  for (const { checkout } of checkouts) {
    counts.set(checkout.directoryName, (counts.get(checkout.directoryName) ?? 0) + 1);
  }

  return (
    [...counts].toSorted(([, left], [, right]) => right - left)[0]?.[0] ??
    checkouts[0].checkout.directoryName
  );
}

/**
 * What tells a repository apart from others with its name: the owner path on its host, such as
 * `acme` for `acme/shop`, leaving out Azure DevOps' `_git` segment. A local-only repository has no
 * owner, so its root commit stands in.
 */
function qualifier(identity: Repository["identity"]): string {
  if (identity._tag === "RootCommit") {
    return identity.sha.slice(0, 7);
  }

  const owner = identity.path.split("/").slice(0, -1);

  return (owner.at(-1) === "_git" ? owner.slice(0, -1) : owner).join("/");
}

/** Each name once, or qualified when repositories share it, even differing only in case. */
function labelsFor(
  repositories: ReadonlyArray<Omit<Repository, "label">>,
): Map<RepositoryKey, string> {
  const counts = new Map<string, number>();

  for (const { name } of repositories) {
    counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  }

  return new Map(
    repositories.map(({ key, identity, name }) => {
      if ((counts.get(name.toLowerCase()) ?? 0) < 2) {
        return [key, name];
      }

      return [
        key,
        identity._tag === "Remote"
          ? `${qualifier(identity)}/${name}`
          : `${name} (${qualifier(identity)})`,
      ];
    }),
  );
}

/**
 * T3 Code's project for each repository: of the projects whose folder is one of its checkouts, the
 * one changed most recently.
 */
function t3CodeProjects(
  machines: ReadonlyArray<MachineRecord>,
  checkouts: ReadonlyArray<MachineCheckout>,
): Map<RepositoryKey, T3CodeProject> {
  const byMachine = new Map(
    machines.map((machine) => [
      machine.id,
      new Map(
        machine.t3Code?.reading._tag === "Read"
          ? machine.t3Code.reading.projects.map((project) => [project.path, project])
          : [],
      ),
    ]),
  );

  const chosen = new Map<RepositoryKey, T3CodeProject>();

  for (const { machineId, checkout } of checkouts) {
    const project = byMachine.get(machineId)?.get(checkout.path);
    const key = repositoryKey(checkout.identity);
    const current = chosen.get(key);

    if (
      project !== undefined &&
      (current === undefined || DateTime.isGreaterThan(project.updatedAt, current.updatedAt))
    ) {
      chosen.set(key, project);
    }
  }

  return chosen;
}

/**
 * Each repository's label: T3 Code's name for its project, or the label that tells it apart by
 * name. A T3 Code name that another repository also goes by keeps that label beside it.
 */
function withProjectTitles(
  labels: ReadonlyMap<RepositoryKey, string>,
  projects: ReadonlyMap<RepositoryKey, T3CodeProject>,
): Map<RepositoryKey, string> {
  const shown = new Map(
    [...labels].map(([key, label]) => [key, projects.get(key)?.title ?? label] as const),
  );

  const counts = new Map<string, number>();

  for (const label of shown.values()) {
    counts.set(label.toLowerCase(), (counts.get(label.toLowerCase()) ?? 0) + 1);
  }

  return new Map(
    [...shown].map(([key, label]) => {
      const title = projects.get(key)?.title;

      return [
        key,
        title !== undefined && (counts.get(label.toLowerCase()) ?? 0) > 1
          ? `${title} (${labels.get(key) ?? label})`
          : label,
      ];
    }),
  );
}

/**
 * Groups checkouts by repository, labelled from `labels`, which tells apart every repository the
 * fleet has. A repository without a label goes by its name.
 */
function groupRepositories(
  checkouts: ReadonlyArray<MachineCheckout>,
  labels: ReadonlyMap<RepositoryKey, string>,
  projects: ReadonlyMap<RepositoryKey, T3CodeProject>,
): ReadonlyArray<Repository> {
  const groups = new Map<RepositoryKey, CheckoutGroup>();

  for (const entry of checkouts) {
    const key = repositoryKey(entry.checkout.identity);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [entry]);
    } else {
      group.push(entry);
    }
  }

  const named = [...groups].map(([key, members]) => ({
    key,
    identity: members[0].checkout.identity,
    name: repositoryName(members),
    checkouts: members,
  }));

  return named
    .map((repository): Repository => ({
      ...repository,
      label: labels.get(repository.key) ?? repository.name,
      icon: projects.get(repository.key)?.icon ?? null,
    }))
    .toSorted(
      (left, right) =>
        collator.compare(
          projects.get(left.key)?.title ?? left.name,
          projects.get(right.key)?.title ?? right.name,
        ) || collator.compare(left.label, right.label),
    );
}

/** Groups every machine's checkouts into repositories and attaches live connection state. */
export function buildFleet(sources: {
  readonly machines: ReadonlyArray<MachineRecord>;
  readonly checkouts: ReadonlyArray<MachineCheckout>;
  readonly online: ReadonlyMap<MachineId, OnlineAgent>;
  readonly hubVersion: string;
  readonly updates: ReadonlyMap<MachineId, AgentUpdate>;
  readonly polling: PollingSettings;
  readonly integrations: IntegrationSettings;
}): Fleet {
  const { t3Code } = sources.integrations;

  const machines = sources.machines.map((record): Machine => {
    const agent = sources.online.get(record.id);
    const statuses = new Map(record.rootStatuses.map(({ path, status }) => [path, status]));

    return {
      id: record.id,
      info: record.info,
      customName: record.customName,
      customKind: record.customKind,
      connection:
        agent === undefined
          ? Connection.cases.Offline.make({ lastSeenAt: record.lastSeenAt })
          : Connection.cases.Online.make({ since: agent.since, capabilities: agent.capabilities }),
      discoveryRoots: record.discoveryRoots.map((path) => ({
        path,
        status: statuses.get(path) ?? null,
      })),
      archiveFolder: record.archiveFolder,
      archiveFolderStatus:
        record.archiveFolder === null ? null : (statuses.get(record.archiveFolder) ?? null),
      lastDiscoveryAt: record.lastDiscoveryAt,
      lastStatusAt: record.lastStatusAt,
      pairedAt: record.pairedAt,
      usage: record.usage,
      trash: record.trash,
      t3Code: t3Code.enabled ? record.t3Code : null,
      update: sources.updates.get(record.id) ?? null,
    };
  });

  const projects =
    t3Code.enabled && t3Code.projectAppearance
      ? t3CodeProjects(sources.machines, sources.checkouts)
      : new Map<RepositoryKey, T3CodeProject>();

  // Labels tell apart every repository the fleet has, archived or not, so both lists agree.
  const labels = withProjectTitles(
    labelsFor(groupRepositories(sources.checkouts, new Map(), new Map())),
    projects,
  );

  const repositories = groupRepositories(
    sources.checkouts.filter(({ checkout }) => checkout.placement._tag === "Projects"),
    labels,
    projects,
  );

  const archive = groupRepositories(
    sources.checkouts.filter(({ checkout }) => checkout.placement._tag === "Archive"),
    labels,
    projects,
  );

  return {
    hubVersion: sources.hubVersion,
    machines,
    repositories,
    archive,
    polling: sources.polling,
    integrations: sources.integrations,
  };
}
