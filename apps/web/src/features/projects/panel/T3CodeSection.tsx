import { BotIcon } from "lucide-react";

import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { projectsAt, threadsAt } from "../../t3Code/t3CodeLookup.ts";
import { PanelSection, ShortList } from "./PanelSection.tsx";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

const stateWords = {
  Working: "Working",
  Waiting: "Waiting for you",
  Idle: null,
} satisfies Record<T3CodeThread["state"], string | null>;

export function T3CodeSection({
  machine,
  checkout,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const [project] = projectsAt(machine, [checkout.path]);
  const threads = threadsAt(machine, checkout.path);

  if (project === undefined && threads.length === 0) {
    return null;
  }

  return (
    <PanelSection title="T3 Code" icon={BotIcon} tone="sync" count={threads.length}>
      <div className="space-y-3">
        {project !== undefined && (
          <p className="flex items-center gap-2 text-sm">
            {project.icon !== null && <ProjectIcon icon={project.icon} />}
            <span className="min-w-0 flex-1 truncate font-medium">{project.title}</span>
            {project.autoPull && (
              <span className="shrink-0 text-xs text-ink-muted">Pulls automatically</span>
            )}
          </p>
        )}
        {threads.length === 0 ? (
          <p className="text-sm text-ink-muted">No threads changed here in the last two weeks.</p>
        ) : (
          <ShortList
            items={threads}
            total={threads.length}
            noun="threads"
            render={(thread) => {
              const state = stateWords[thread.state];

              return (
                <li key={thread.id} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={thread.title}>
                    {thread.title}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${state === null ? "text-ink-muted" : "font-medium text-sync"}`}
                  >
                    {state ?? <RelativeTime at={thread.updatedAt} />}
                  </span>
                </li>
              );
            }}
          />
        )}
      </div>
    </PanelSection>
  );
}
