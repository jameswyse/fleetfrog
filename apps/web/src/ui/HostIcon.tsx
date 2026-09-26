import { HardDriveIcon } from "lucide-react";

import type { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

/*
 * Git hosts' logos from Simple Icons (https://simpleicons.org), released under CC0. The logos stay
 * their owners' trademarks. Each is one 24-unit path, filled with the current text colour, with
 * every number and arc flag separated so that every browser parses it.
 */
const logoPaths = {
  github:
    "M 12 .297 c -6.63 0 -12 5.373 -12 12 0 5.303 3.438 9.8 8.205 11.385 .6 .113 .82 -.258 .82 -.577 0 -.285 -.01 -1.04 -.015 -2.04 -3.338 .724 -4.042 -1.61 -4.042 -1.61 C 4.422 18.07 3.633 17.7 3.633 17.7 c -1.087 -.744 .084 -.729 .084 -.729 1.205 .084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495 .998 .108 -.776 .417 -1.305 .76 -1.605 -2.665 -.3 -5.466 -1.332 -5.466 -5.93 0 -1.31 .465 -2.38 1.235 -3.22 -.135 -.303 -.54 -1.523 .105 -3.176 0 0 1.005 -.322 3.3 1.23 .96 -.267 1.98 -.399 3 -.405 1.02 .006 2.04 .138 3 .405 2.28 -1.552 3.285 -1.23 3.285 -1.23 .645 1.653 .24 2.873 .12 3.176 .765 .84 1.23 1.91 1.23 3.22 0 4.61 -2.805 5.625 -5.475 5.92 .42 .36 .81 1.096 .81 2.22 0 1.606 -.015 2.896 -.015 3.286 0 .315 .21 .69 .825 .57 C 20.565 22.092 24 17.592 24 12.297 c 0 -6.627 -5.373 -12 -12 -12",
  gitlab:
    "m 23.6004 9.5927 -.0337 -.0862 L 20.3 .9814 a .851 .851 0 0 0 -.3362 -.405 .8748 .8748 0 0 0 -.9997 .0539 .8748 .8748 0 0 0 -.29 .4399 l -2.2055 6.748 H 7.5375 l -2.2057 -6.748 a .8573 .8573 0 0 0 -.29 -.4412 .8748 .8748 0 0 0 -.9997 -.0537 .8585 .8585 0 0 0 -.3362 .4049 L .4332 9.5015 l -.0325 .0862 a 6.0657 6.0657 0 0 0 2.0119 7.0105 l .0113 .0087 .03 .0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321 a 1.0085 1.0085 0 0 0 1.2197 0 l 1.4995 -1.1321 2.4619 -1.8633 5.006 -3.7489 .0125 -.01 a 6.0682 6.0682 0 0 0 2.0094 -7.003 z",
  bitbucket:
    "M .778 1.213 a .768 .768 0 0 0 -.768 .892 l 3.263 19.81 c .084 .5 .515 .868 1.022 .873 H 19.95 a .772 .772 0 0 0 .77 -.646 l 3.27 -20.03 a .768 .768 0 0 0 -.768 -.891 z M 14.52 15.53 H 9.522 L 8.17 8.466 h 7.561 z",
  codeberg:
    "M 11.999 .747 A 11.974 11.974 0 0 0 0 12.75 c 0 2.254 .635 4.465 1.833 6.376 L 11.837 6.19 c .072 -.092 .251 -.092 .323 0 l 4.178 5.402 h -2.992 l .065 .239 h 3.113 l .882 1.138 h -3.674 l .103 .374 h 3.86 l .777 1.003 h -4.358 l .135 .483 h 4.593 l .695 .894 h -5.038 l .165 .589 h 5.326 l .609 .785 h -5.717 l .182 .65 h 6.038 l .562 .727 h -6.397 l .183 .65 h 6.717 A 12.003 12.003 0 0 0 24 12.75 11.977 11.977 0 0 0 11.999 .747 z m 3.654 19.104 .182 .65 h 5.326 c .173 -.204 .353 -.433 .513 -.65 z m .385 1.377 .18 .65 h 3.563 c .233 -.198 .485 -.428 .712 -.65 z m .383 1.377 .182 .648 h 1.203 c .356 -.204 .685 -.412 1.042 -.648 z z",
  gitea:
    "M 4.209 4.603 c -.247 0 -.525 .02 -.84 .088 -.333 .07 -1.28 .283 -2.054 1.027 C -.403 7.25 .035 9.685 .089 10.052 c .065 .446 .263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092 s .462 1.103 1.168 2.119 c .955 1.263 1.936 2.248 2.89 2.367 2.406 0 7.212 -.004 7.212 -.004 s .458 .004 1.08 -.394 c .535 -.324 1.013 -.893 1.013 -.893 s .492 -.527 1.18 -1.73 c .21 -.37 .385 -.729 .538 -1.068 0 0 2.107 -4.471 2.107 -8.823 -.042 -1.318 -.367 -1.55 -.443 -1.627 -.156 -.156 -.366 -.153 -.366 -.153 s -4.475 .252 -6.792 .306 c -.508 .011 -1.012 .023 -1.512 .027 v 4.474 l -.634 -.301 c 0 -1.39 -.004 -4.17 -.004 -4.17 -1.107 .016 -3.405 -.084 -3.405 -.084 s -5.399 -.27 -5.987 -.324 c -.187 -.011 -.401 -.032 -.648 -.032 z m .354 1.832 h .111 s .271 2.269 .6 3.597 C 5.549 11.147 6.22 13 6.22 13 s -.996 -.119 -1.641 -.348 c -.99 -.324 -1.409 -.714 -1.409 -.714 s -.73 -.511 -1.096 -1.52 C 1.444 8.73 2.021 7.7 2.021 7.7 s .32 -.859 1.47 -1.145 c .395 -.106 .863 -.12 1.072 -.12 z m 8.33 2.554 c .26 .003 .509 .127 .509 .127 l .868 .422 -.529 1.075 a .686 .686 0 0 0 -.614 .359 .685 .685 0 0 0 .072 .756 l -.939 1.924 a .69 .69 0 0 0 -.66 .527 .687 .687 0 0 0 .347 .763 .686 .686 0 0 0 .867 -.206 .688 .688 0 0 0 -.069 -.882 l .916 -1.874 a .667 .667 0 0 0 .237 -.02 .657 .657 0 0 0 .271 -.137 8.826 8.826 0 0 1 1.016 .512 .761 .761 0 0 1 .286 .282 c .073 .21 -.073 .569 -.073 .569 -.087 .29 -.702 1.55 -.702 1.55 a .692 .692 0 0 0 -.676 .477 .681 .681 0 1 0 1.157 -.252 c .073 -.141 .141 -.282 .214 -.431 .19 -.397 .515 -1.16 .515 -1.16 .035 -.066 .218 -.394 .103 -.814 -.095 -.435 -.48 -.638 -.48 -.638 -.467 -.301 -1.116 -.58 -1.116 -.58 s 0 -.156 -.042 -.27 a .688 .688 0 0 0 -.148 -.241 l .516 -1.062 2.89 1.401 s .48 .218 .583 .619 c .073 .282 -.019 .534 -.069 .657 -.24 .587 -2.1 4.317 -2.1 4.317 s -.232 .554 -.748 .588 a 1.065 1.065 0 0 1 -.393 -.045 l -.202 -.08 -4.31 -2.1 s -.417 -.218 -.49 -.596 c -.083 -.31 .104 -.691 .104 -.691 l 2.073 -4.272 s .183 -.37 .466 -.497 a .855 .855 0 0 1 .35 -.077 z",
  sourcehut:
    "M 12 0 C 5.371 0 0 5.371 0 12 s 5.371 12 12 12 12 -5.371 12 -12 S 18.629 0 12 0 Z m 0 21.677 A 9.675 9.675 0 0 1 2.323 12 9.675 9.675 0 0 1 12 2.323 9.675 9.675 0 0 1 21.677 12 9.675 9.675 0 0 1 12 21.677 Z",
  git: "M 13.09 23.549 a 1.54 1.54 0 0 1 -2.18 0 L .451 13.089 a 1.54 1.54 0 0 1 0 -2.179 l 7.191 -7.19 2.733 2.733 a 1.85 1.85 0 0 0 .964 2.326 v 6.66 a 1.849 1.849 0 1 0 1.54 0 V 8.957 l 2.508 2.508 a 1.85 1.85 0 1 0 1.09 -1.09 l -2.634 -2.634 a 1.85 1.85 0 0 0 -2.378 -2.377 L 8.73 2.63 10.91 .451 a 1.54 1.54 0 0 1 2.179 0 l 10.459 10.46 a 1.54 1.54 0 0 1 0 2.179 z",
} as const;

type Logo = keyof typeof logoPaths;

/** The service that hosts a repository, named for people, with the logo to draw beside it. */
export interface GitHost {
  readonly name: string;
  /** Null for a repository with no remote. */
  readonly logo: Logo | null;
  /** The logo's own colour, where a plain one would be hard to recognise; null keeps the text colour. */
  readonly colour: string | null;
}

/** Recognises common hosts by name, including self-hosted GitHub, GitLab and Gitea servers. */
export function gitHost(identity: RepositoryIdentity): GitHost {
  if (identity._tag === "RootCommit") {
    return { name: "Local repository", logo: null, colour: null };
  }

  const host = identity.host.toLowerCase();

  if (host.includes("github")) {
    return { name: "GitHub", logo: "github", colour: null };
  }

  if (host.includes("gitlab")) {
    return { name: "GitLab", logo: "gitlab", colour: null };
  }

  if (host.includes("bitbucket")) {
    return { name: "Bitbucket", logo: "bitbucket", colour: "var(--bitbucket)" };
  }

  if (host === "codeberg.org") {
    return { name: "Codeberg", logo: "codeberg", colour: null };
  }

  if (host.includes("gitea")) {
    return { name: "Gitea", logo: "gitea", colour: null };
  }

  if (host === "git.sr.ht") {
    return { name: "SourceHut", logo: "sourcehut", colour: null };
  }

  // Simple Icons has no Azure DevOps logo, so it shares Git's.
  if (host === "dev.azure.com" || host.endsWith(".visualstudio.com")) {
    return { name: "Azure DevOps", logo: "git", colour: null };
  }

  return { name: identity.host, logo: "git", colour: null };
}

/** A repository host's logo. Decorative: the host's name belongs beside it or in a tooltip. */
export function HostIcon({
  host,
  className = "",
}: {
  readonly host: GitHost;
  readonly className?: string;
}) {
  if (host.logo === null) {
    return <HardDriveIcon className={className} />;
  }

  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`shrink-0 ${className}`}
      style={host.colour === null ? undefined : { color: host.colour }}
    >
      <path d={logoPaths[host.logo]} />
    </svg>
  );
}

/** GitHub's logo, for sections about what GitHub reports. */
export function GitHubIcon({ className = "" }: { readonly className?: string }) {
  return <HostIcon host={{ name: "GitHub", logo: "github", colour: null }} className={className} />;
}
