import { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";
import { Option } from "effect";

const scpLikeRemote = /^(?:[^@/]+@)?(?<host>[^:/]+):(?!\/)(?<path>.+)$/;
const trailingGitSuffix = /\.git\/?$/;
const surroundingSlashes = /^\/+|\/+$/g;

/**
 * Normalises a Git remote URL so SSH, SCP-like and HTTPS forms of the same repository compare
 * equal. Returns `None` for local paths and URLs without a repository path.
 */
export function remoteIdentity(remoteUrl: string): Option.Option<RepositoryIdentity> {
  const trimmed = remoteUrl.trim();
  let host: string;
  let path: string;

  // SCP-like remotes such as `github.com:acme/shop` also parse as URLs with a `github.com:` scheme.
  if (trimmed.includes("://") && URL.canParse(trimmed)) {
    const url = new URL(trimmed);

    if (url.protocol === "file:" || url.hostname === "") {
      return Option.none();
    }

    host = url.hostname;
    path = decodeURIComponent(url.pathname);
  } else {
    const groups = scpLikeRemote.exec(trimmed)?.groups;

    if (groups?.host === undefined || groups.path === undefined) {
      return Option.none();
    }

    host = groups.host;
    path = groups.path;
  }

  const normalisedPath = path
    .replace(trailingGitSuffix, "")
    .replace(surroundingSlashes, "")
    .toLowerCase();

  if (normalisedPath === "") {
    return Option.none();
  }

  return Option.some(
    RepositoryIdentity.cases.Remote.make({ host: host.toLowerCase(), path: normalisedPath }),
  );
}
