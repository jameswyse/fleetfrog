import { gitHost, HostIcon } from "@/ui/HostIcon.tsx";

import type { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

/** Where the repository lives, as its host's logo and its path there, linking to it. */
export function RepositoryLink({ identity }: { readonly identity: RepositoryIdentity }) {
  const host = gitHost(identity);

  if (identity._tag !== "Remote") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <HostIcon host={host} />
        Local repository with no remote
      </span>
    );
  }

  return (
    <a
      href={`https://${identity.host}/${identity.path}`}
      target="_blank"
      rel="noreferrer"
      title={`${identity.host}/${identity.path}`}
      className="inline-flex max-w-full items-center gap-1.5 text-accent-text underline-offset-2 hover:underline"
    >
      <HostIcon host={host} />
      <span className="truncate">{identity.path}</span>
      <span className="sr-only"> on {host.name} (opens in a new tab)</span>
    </a>
  );
}
