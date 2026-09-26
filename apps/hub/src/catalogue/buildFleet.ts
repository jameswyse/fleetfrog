import { Connection } from "@fleetfrog/protocol/domain/fleet";
import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { PollingSettings } from "@fleetfrog/protocol/domain/polling";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";
import type { DateTime } from "effect";

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

/** Groups every machine's checkouts into repositories and attaches live connection state. */
export function buildFleet(sources: {
  readonly machines: ReadonlyArray<MachineRecord>;
  readonly checkouts: ReadonlyArray<MachineCheckout>;
  readonly online: ReadonlyMap<MachineId, DateTime.Utc>;
  readonly polling: PollingSettings;
}): Fleet {
  const machines = sources.machines.map((record): Machine => {
    const since = sources.online.get(record.id);

    return {
      id: record.id,
      info: record.info,
      customName: record.customName,
      connection:
        since === undefined
          ? Connection.cases.Offline.make({ lastSeenAt: record.lastSeenAt })
          : Connection.cases.Online.make({ since }),
      discoveryRoots: record.discoveryRoots,
      lastDiscoveryAt: record.lastDiscoveryAt,
      lastStatusAt: record.lastStatusAt,
      pairedAt: record.pairedAt,
    };
  });
  const groups = new Map<RepositoryKey, CheckoutGroup>();

  for (const entry of sources.checkouts) {
    const key = repositoryKey(entry.checkout.identity);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [entry]);
    } else {
      group.push(entry);
    }
  }

  const repositories = [...groups].map(([key, checkouts]): Repository => ({
    key,
    identity: checkouts[0].checkout.identity,
    name: repositoryName(checkouts),
    checkouts,
  }));

  repositories.sort((left, right) => collator.compare(left.name, right.name));

  return { machines, repositories, polling: sources.polling };
}
