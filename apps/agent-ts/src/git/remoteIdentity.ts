import { Option } from "effect";

import { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

const scpLikeRemote = /^(?:[^@/]+@)?(?<host>[^:/]+):(?!\/)(?<path>.+)$/;
const trailingGitSuffix = /\.git\/?$/;
const surroundingSlashes = /^\/+|\/+$/g;

export function remoteIdentity(remoteUrl: string): Option.Option<RepositoryIdentity> {
  const trimmed = remoteUrl.trim();
  let host: string;
  let path: string;

  if (trimmed.includes("://") && URL.canParse(trimmed)) {
    const url = new URL(trimmed);

    if (url.protocol === "file:" || url.hostname === "") {
      return Option.none();
    }

    host = url.hostname;

    try {
      path = decodeURIComponent(url.pathname);
    } catch {
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

export function cloneableUrl(remoteUrl: string): Option.Option<string> {
  const trimmed = remoteUrl.trim();
  const identity = remoteIdentity(trimmed);

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
