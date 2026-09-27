import { Option } from "effect";

import { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

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

    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      // A malformed escape cannot name a hosted repository.
      return Option.none();
    }
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

const unsafeCharacters = /[\s\p{Cc}]/u;

/**
 * The form of a remote URL that is safe to share and clone from: HTTPS without credentials, or
 * SSH in URL or SCP-like form. Returns `None` for local paths, other transports, URLs that could
 * pass for a Git option, and anything without a repository path.
 */
export function cloneableUrl(remoteUrl: string): Option.Option<string> {
  const trimmed = remoteUrl.trim();
  const identity = remoteIdentity(trimmed);

  // A host starting with `-` could reach SSH as an option.
  if (
    trimmed.startsWith("-") ||
    unsafeCharacters.test(trimmed) ||
    Option.isNone(identity) ||
    identity.value._tag !== "Remote" ||
    identity.value.host.startsWith("-")
  ) {
    return Option.none();
  }

  if (!trimmed.includes("://")) {
    return Option.some(trimmed);
  }

  // An SCP-like remote whose path happens to contain `://` is not a URL.
  if (!URL.canParse(trimmed)) {
    return Option.none();
  }

  const url = new URL(trimmed);

  if (url.protocol === "https:") {
    url.username = "";
    url.password = "";

    return Option.some(url.href);
  }

  if (url.protocol === "ssh:") {
    url.password = "";

    return Option.some(url.href);
  }

  return Option.none();
}
