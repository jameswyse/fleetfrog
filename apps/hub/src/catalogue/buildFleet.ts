import { Connection } from "@fleetfrog/protocol/domain/fleet";
import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { PollingSettings } from "@fleetfrog/protocol/domain/polling";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

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
 * Groups checkouts by repository, labelled from `labels`, which tells apart every repository the
 * fleet has. A repository without a label goes by its name.
 */
function groupRepositories(
  checkouts: ReadonlyArray<MachineCheckout>,
  labels: ReadonlyMap<RepositoryKey, string>,
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
    }))
    .toSorted(
      (left, right) =>
        collator.compare(left.name, right.name) || collator.compare(left.label, right.label),
    );
}

/** Groups every machine's checkouts into repositories and attaches live connection state. */
export function buildFleet(sources: {
  readonly machines: ReadonlyArray<MachineRecord>;
  readonly checkouts: ReadonlyArray<MachineCheckout>;
  readonly online: ReadonlyMap<MachineId, OnlineAgent>;
  readonly polling: PollingSettings;
}): Fleet {
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
    };
  });
  // Labels tell apart every repository the fleet has, archived or not, so both lists agree.
  const labels = labelsFor(groupRepositories(sources.checkouts, new Map()));
  const repositories = groupRepositories(
    sources.checkouts.filter(({ checkout }) => checkout.placement._tag === "Projects"),
    labels,
  );
  const archive = groupRepositories(
    sources.checkouts.filter(({ checkout }) => checkout.placement._tag === "Archive"),
    labels,
  );

  return {
    machines,
    repositories,
    archive,
    polling: sources.polling,
  };
}
