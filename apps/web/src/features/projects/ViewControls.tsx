import { useId, useState } from "react";

import { ArrowDownUpIcon, ChevronDownIcon, FolderPlusIcon, LayersIcon } from "lucide-react";

import { Menu, MenuItem } from "@/ui/Menu.tsx";
import { Switch } from "@/ui/Switch.tsx";

import { changeProjectLayout, usePreferences } from "../preferences/preferences.ts";
import { GroupDialog } from "./GroupDialog.tsx";

import type { Repository } from "@fleetfrog/protocol/domain/fleet";
import type { ProjectSort } from "@fleetfrog/protocol/domain/preferences";

const triggerClass =
  "inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-raised";

const sorts: ReadonlyArray<{
  readonly value: ProjectSort;
  readonly label: string;
  readonly description: string;
}> = [
  { value: "name", label: "Name", description: "A to Z" },
  {
    value: "updated",
    label: "Recently updated",
    description: "Newest commit on any machine first",
  },
  {
    value: "attention",
    label: "Needs attention",
    description: "Problems, then changes, then out of sync",
  },
];

function SortMenu() {
  const { projects: layout } = usePreferences();
  const current = sorts.find(({ value }) => value === layout.sort) ?? sorts[0];

  return (
    <Menu
      trigger={{
        className: triggerClass,
        content: (
          <>
            <ArrowDownUpIcon aria-hidden="true" className="size-4 text-ink-muted" />
            <span>
              <span className="sr-only">Sort: </span>
              {current?.label}
            </span>
            <ChevronDownIcon aria-hidden="true" className="size-4 text-ink-muted" />
          </>
        ),
      }}
    >
      {(close) => (
        <fieldset>
          <legend className="px-3 pt-2 pb-1 text-xs font-medium text-ink-muted">Sort by</legend>
          {sorts.map(({ value, label, description }) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2.5 rounded px-3 py-2 hover:bg-surface-raised has-focus-visible:outline-2 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name="project-sort"
                value={value}
                checked={layout.sort === value}
                onChange={() => {
                  void changeProjectLayout((previous) => ({ ...previous, sort: value }));
                  close();
                }}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span className="grid">
                <span className="text-sm">{label}</span>
                <span className="text-xs text-ink-muted">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Menu>
  );
}

function GroupsMenu({ repositories }: { readonly repositories: ReadonlyArray<Repository> }) {
  const { projects: layout } = usePreferences();
  const ownerId = useId();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Menu
        trigger={{
          className: triggerClass,
          content: (
            <>
              <LayersIcon aria-hidden="true" className="size-4 text-ink-muted" />
              Groups
              <ChevronDownIcon aria-hidden="true" className="size-4 text-ink-muted" />
            </>
          ),
        }}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<FolderPlusIcon />}
              onClick={() => {
                close();
                setCreating(true);
              }}
            >
              New group…
            </MenuItem>
            <div className="my-1 border-t border-line" />
            <div className="flex items-start justify-between gap-3 px-3 py-2">
              <label htmlFor={ownerId} className="grid cursor-pointer">
                <span className="text-sm">Group by owner</span>
                <span id={`${ownerId}-description`} className="text-xs text-ink-muted">
                  A section for each user or organisation, after your own groups
                </span>
              </label>
              <Switch
                id={ownerId}
                checked={layout.groupByOwner}
                aria-describedby={`${ownerId}-description`}
                onChange={(groupByOwner) => {
                  void changeProjectLayout((previous) => ({ ...previous, groupByOwner }));
                }}
              />
            </div>
          </>
        )}
      </Menu>
      {creating && (
        <GroupDialog repositories={repositories} group={null} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

export function ViewControls({
  repositories,
}: {
  readonly repositories: ReadonlyArray<Repository>;
}) {
  return (
    <>
      <SortMenu />
      <GroupsMenu repositories={repositories} />
    </>
  );
}
