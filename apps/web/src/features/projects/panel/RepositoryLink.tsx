import { gitHost, HostIcon } from "@/ui/HostIcon.tsx";

import { usePreferences } from "../../preferences/preferences.ts";

import type { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

/** Where the repository lives, as its host's logo and its path there, linking to it. */
export function RepositoryLink({ identity }: { readonly identity: RepositoryIdentity }) {
  const host = gitHost(identity);
  const { blurPersonal } = usePreferences();

  if (identity._tag !== "Remote") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <HostIcon host={host} />
        Local repository with no remote
      </span>
    );
  }

  // The owner is the first part of the path, when there is more than one.
  const slash = identity.path.indexOf("/");
  const owner = identity.path.slice(0, Math.max(slash, 0));
  const name = identity.path.slice(slash + 1);
  const shownOwner = blurPersonal ? "•••" : owner;

  return (
    <a
      href={`https://${identity.host}/${identity.path}`}
      target="_blank"
      rel="noreferrer"
      title={`${identity.host}/${owner === "" ? "" : `${shownOwner}/`}${name}`}
      className="inline-flex max-w-full items-center gap-1.5 text-accent-text underline-offset-2 hover:underline"
    >
      <HostIcon host={host} />
      <span className="truncate">
        {owner !== "" && (
          <>
            <span data-personal>{owner}</span>/
          </>
        )}
        {name}
      </span>
      <span className="sr-only"> on {host.name} (opens in a new tab)</span>
    </a>
  );
}
