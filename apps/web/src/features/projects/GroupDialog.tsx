import { useState, useTransition } from "react";

import { SearchIcon } from "lucide-react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { gitHost, HostIcon } from "@/ui/HostIcon.tsx";
import { plural } from "@/ui/plural.ts";
import { TextField } from "@/ui/TextField.tsx";
import {
  maximumProjectGroupNameLength,
  ProjectGroupId,
} from "@fleetfrog/protocol/domain/preferences";

import { changeProjectLayout, usePreferences } from "../preferences/preferences.ts";
import { saveGroup } from "./layoutChanges.ts";
import { groupOf } from "./projectLayout.ts";

import type { Repository } from "@fleetfrog/protocol/domain/fleet";
import type { ProjectGroup } from "@fleetfrog/protocol/domain/preferences";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

function nameProblem(name: string, others: ReadonlyArray<ProjectGroup>): string | null {
  const trimmed = name.trim();

  if (trimmed === "") {
    return "Enter a name for the group.";
  }

  return others.some((group) => group.name.toLowerCase() === trimmed.toLowerCase())
    ? `You already have a group called ${trimmed}.`
    : null;
}

function repositoryPath(repository: Repository): string {
  return repository.identity._tag === "Remote" ? repository.identity.path : "No remote";
}

export function GroupDialog({
  repositories,
  group,
  initialMembers = [],
  onClose,
}: {
  readonly repositories: ReadonlyArray<Repository>;
  readonly group: ProjectGroup | null;
  readonly initialMembers?: ReadonlyArray<RepositoryKey>;
  readonly onClose: () => void;
}) {
  const { projects: layout } = usePreferences();
  const [name, setName] = useState(group?.name ?? "");
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [id] = useState(() => group?.id ?? ProjectGroupId.make(crypto.randomUUID()));

  const [members, setMembers] = useState<ReadonlySet<RepositoryKey>>(
    () => new Set(group?.repositories ?? initialMembers),
  );

  const others = layout.groups.filter((other) => other.id !== id);
  const pinned = new Set(layout.pinned);
  const needle = query.trim().toLowerCase();

  const listed = repositories.filter(
    (repository) =>
      needle === "" ||
      [repository.label, repositoryPath(repository)].some((text) =>
        text.toLowerCase().includes(needle),
      ),
  );

  const pinnedMembers = repositories.filter(
    ({ key }) => members.has(key) && pinned.has(key),
  ).length;

  const toggle = (key: RepositoryKey, checked: boolean) => {
    const next = new Set(members);

    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }

    setMembers(next);
  };

  const submit = () => {
    const found = nameProblem(name, others);

    setProblem(found);

    if (found !== null) {
      return;
    }

    const saved: ProjectGroup = {
      id,
      name: name.trim(),
      repositories: repositories.flatMap(({ key }) => (members.has(key) ? [key] : [])),
    };

    startSaving(async () => {
      const result = await changeProjectLayout((current) => saveGroup(current, saved));

      if (result._tag === "Failure") {
        setFailure(`Couldn't save the group. ${result.message}`);
      } else {
        onClose();
      }
    });
  };

  let submitLabel = group === null ? "Create group" : "Save";

  if (saving) {
    submitLabel = "Saving…";
  }

  return (
    <Dialog title={group === null ? "New group" : `Edit ${group.name}`} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-4 text-sm"
      >
        <TextField
          label="Name"
          name="name"
          value={name}
          autoComplete="off"
          data-autofocus
          maxLength={maximumProjectGroupNameLength}
          error={problem ?? undefined}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <fieldset className="min-w-0 space-y-2">
          <legend className="flex w-full items-baseline justify-between gap-3 font-medium">
            Repositories
            <span className="font-normal text-ink-muted tabular-nums">{members.size} selected</span>
          </legend>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              aria-label="Filter repositories"
              placeholder="Filter repositories"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                }
              }}
              className="min-h-9 w-full rounded-md border border-line bg-canvas ps-8 pe-2.5"
            />
          </div>
          <ul className="max-h-72 overflow-auto rounded-md border border-line">
            {listed.length === 0 && (
              <li className="px-3 py-6 text-center text-ink-muted">No repositories match.</li>
            )}
            {listed.map((repository) => {
              const current = groupOf(layout, repository);
              const elsewhere = current !== null && current.id !== id ? current : null;

              return (
                <li key={repository.key} className="border-b border-line last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-raised">
                    <input
                      type="checkbox"
                      checked={members.has(repository.key)}
                      onChange={(event) => toggle(repository.key, event.currentTarget.checked)}
                      className="size-4 shrink-0 accent-accent"
                    />
                    <HostIcon host={gitHost(repository.identity)} className="text-ink-muted" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{repository.label}</span>
                      <span className="truncate text-xs text-ink-muted">
                        {repositoryPath(repository)}
                      </span>
                    </span>
                    {elsewhere !== null && (
                      <span className="shrink-0 truncate text-xs text-ink-muted">
                        In {elsewhere.name}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-ink-muted">
            A repository belongs to one group, so choosing one from another group moves it here.
            {pinnedMembers > 0 &&
              ` ${plural(pinnedMembers, "pinned repository", "pinned repositories")} will stay in Pinned until you unpin ${pinnedMembers === 1 ? "it" : "them"}.`}
          </p>
        </fieldset>
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit" disabled={saving}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
