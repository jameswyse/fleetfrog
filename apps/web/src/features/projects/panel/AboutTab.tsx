import { PathText } from "@/ui/PathText.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { workingTreesOf } from "../workingTrees.ts";
import { ListSection } from "./ListSection.tsx";
import { Fact, Facts } from "./PanelSection.tsx";

import type { GithubState } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { CloneOutline } from "../workingTrees.ts";

function RemoteState({ github }: { readonly github: GithubState }) {
  if (github.trackingSha === null) {
    return <span className="text-ink-muted">Not fetched on this machine yet</span>;
  }

  return github.trackingSha === github.remoteSha ? (
    <span className="text-clean">Matches this machine's last fetch</span>
  ) : (
    <span className="text-sync">Has commits this machine hasn't fetched</span>
  );
}

export function AboutTab({
  repository,
  machine,
  clones,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clones: ReadonlyArray<CloneOutline>;
}) {
  const github = clones.flatMap(({ anchor }) => anchor?.checkout.github ?? [])[0] ?? null;

  const onGithub =
    repository.identity._tag === "Remote" && repository.identity.host === "github.com";

  return (
    <div className="space-y-5">
      {(github !== null || onGithub) && (
        <ListSection title="GitHub">
          <div className="px-2.5 py-2">
            {github === null ? (
              <p className="text-sm text-ink-muted">
                {machine.info.githubCli._tag === "Unavailable"
                  ? `Not available: the GitHub CLI (gh) isn't installed or signed in on ${machineLabel(machine)}.`
                  : "Not available: GitHub couldn't be reached on the last check."}
              </p>
            ) : (
              <Facts>
                <Fact term="Default branch">
                  <span className="font-mono text-[13px]">{github.defaultBranch}</span>
                </Fact>
                <Fact term="Remote">
                  <RemoteState github={github} />
                </Fact>
                <Fact term="Checked">
                  <RelativeTime at={github.checkedAt} />
                </Fact>
              </Facts>
            )}
          </div>
        </ListSection>
      )}
      {clones.map((clone) => {
        const git = clone.anchor?.git ?? null;

        const [scannedAt] = workingTreesOf(clone)
          .flatMap(({ entry }) => (entry === null ? [] : [entry.checkout.scannedAt]))
          .toSorted((left, right) => left.epochMilliseconds - right.epochMilliseconds);

        return (
          <ListSection key={clone.path} title={clones.length === 1 ? "On this machine" : "Clone"}>
            <div className="px-2.5 py-2">
              <Facts>
                <Fact term="Clone">
                  <span className="font-mono text-[13px] [overflow-wrap:anywhere]">
                    <PathText path={clone.path} />
                  </span>
                </Fact>
                {clone.linked.length > 0 && (
                  <Fact term="Worktrees">
                    <ul className="space-y-1">
                      {clone.linked.map((tree) => (
                        <li
                          key={tree.path}
                          className="font-mono text-[13px] [overflow-wrap:anywhere]"
                        >
                          <PathText path={tree.path} />
                        </li>
                      ))}
                    </ul>
                  </Fact>
                )}
                <Fact term="Fetched">
                  {git === null || git.lastFetchedAt === null ? (
                    <span className="text-ink-muted">Never</span>
                  ) : (
                    <RelativeTime at={git.lastFetchedAt} />
                  )}
                </Fact>
                <Fact term="Scanned">
                  {scannedAt === undefined ? (
                    <span className="text-ink-muted">Not yet</span>
                  ) : (
                    <RelativeTime at={scannedAt} />
                  )}
                </Fact>
              </Facts>
            </div>
          </ListSection>
        );
      })}
    </div>
  );
}
