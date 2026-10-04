import { expandHome } from "@fleetfrog/protocol/domain/cloneDestination";

import { cloneDestinationProblem } from "./actionAvailability.ts";

import type { DiscoveryRoot, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

export interface DestinationDraft {
  readonly root: string;
  readonly name: string;
}

const trailingSlashes = /\/+$/;
const leadingSlashes = /^\/+/;

export function draftFromSuggestion(options: {
  readonly machine: {
    readonly info: Pick<Machine["info"], "homeDirectory">;
    readonly discoveryRoots: ReadonlyArray<Pick<DiscoveryRoot, "path">>;
  };
  readonly suggestion: {
    readonly destination: string;
    readonly root: Pick<DiscoveryRoot, "path">;
  } | null;
  readonly repositoryName: string;
}): DestinationDraft {
  const { machine, suggestion, repositoryName } = options;

  if (suggestion === null) {
    return { root: machine.discoveryRoots[0]?.path ?? "", name: repositoryName };
  }

  const home = machine.info.homeDirectory;
  const root = expandHome(suggestion.root.path, home).replace(trailingSlashes, "");
  const destination = expandHome(suggestion.destination, home);

  return {
    root: suggestion.root.path,
    name: destination.startsWith(`${root}/`) ? destination.slice(root.length + 1) : repositoryName,
  };
}

export function draftPath(draft: DestinationDraft): string {
  return `${draft.root.replace(trailingSlashes, "")}/${draft.name.trim().replace(leadingSlashes, "")}`;
}

export function draftProblem(options: {
  readonly draft: DestinationDraft;
  readonly machine: Machine;
  readonly repositories: ReadonlyArray<Repository>;
}): string | null {
  if (options.draft.name.trim().replace(leadingSlashes, "") === "") {
    return "Enter a name for the new folder.";
  }

  return cloneDestinationProblem({
    destination: draftPath(options.draft),
    machine: options.machine,
    repositories: options.repositories,
  });
}
