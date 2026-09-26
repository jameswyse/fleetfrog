import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { useHub } from "@/rpc/hubConnection.ts";

import { CheckoutDetail } from "../checkout-detail/CheckoutDetail.tsx";
import { checkoutKey, repositoryMatches } from "./checkoutSummary.ts";
import { FleetMatrix } from "./FleetMatrix.tsx";

import type { RepositoryFilter } from "./checkoutSummary.ts";

const filters: ReadonlyArray<{ readonly value: RepositoryFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "changes", label: "Has changes" },
  { value: "out-of-sync", label: "Out of sync" },
];

function EmptyState({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="mt-2 text-sm text-ink-muted">{children}</div>
    </div>
  );
}

export function OverviewPage() {
  const hub = useHub();
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const filter = search.filter ?? "all";
  const query = search.q ?? "";

  if (hub._tag === "Connecting" || hub.fleet === null) {
    return (
      <EmptyState
        title={hub._tag === "Connecting" ? "Connecting to the hub…" : "Can't reach the hub"}
      >
        {hub._tag === "Connecting"
          ? "Loading your fleet."
          : "The dashboard will reconnect as soon as the hub is running again."}
      </EmptyState>
    );
  }

  const { machines, repositories } = hub.fleet;

  if (machines.length === 0) {
    return (
      <EmptyState title="No machines yet">
        Pair a development machine and its repositories will appear here.
        <div className="mt-5">
          <Link
            to="/machines"
            search={{ pair: true }}
            className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink"
          >
            Pair a machine
          </Link>
        </div>
      </EmptyState>
    );
  }

  const visible = repositories.filter((repository) =>
    repositoryMatches({ repository, filter, query }),
  );
  const selected = repositories
    .flatMap((repository) => repository.checkouts.map((entry) => ({ repository, entry })))
    .find(({ entry }) => checkoutKey(entry) === search.checkout);
  const selectedMachine = machines.find(({ id }) => id === selected?.entry.machineId);

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <h1 className="text-lg font-semibold">Repositories</h1>
          <p className="text-sm text-ink-muted">
            {visible.length === repositories.length ? "" : `${visible.length} of `}
            {repositories.length} {repositories.length === 1 ? "repository" : "repositories"} across{" "}
            {machines.length} {machines.length === 1 ? "machine" : "machines"}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Find</span>
            <input
              type="search"
              value={query}
              placeholder="Repository name"
              onChange={(event) => {
                const q = event.currentTarget.value;

                void navigate({
                  search: ({ q: _previous, ...rest }) => (q === "" ? rest : { ...rest, q }),
                  replace: true,
                });
              }}
              className="min-h-9 w-52 rounded-md border border-line bg-surface px-2.5"
            />
          </label>
          <fieldset className="flex rounded-md border border-line bg-surface p-0.5">
            <legend className="sr-only">Show</legend>
            {filters.map(({ value, label }) => (
              <label
                key={value}
                className="cursor-pointer rounded px-3 py-1.5 text-sm text-ink-muted has-checked:bg-surface-raised has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name="filter"
                  value={value}
                  checked={filter === value}
                  onChange={() => {
                    void navigate({
                      search: ({ filter: _previous, ...rest }) =>
                        value === "all" ? rest : { ...rest, filter: value },
                      replace: true,
                    });
                  }}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
      </div>
      {repositories.length === 0 && (
        <EmptyState title="Waiting for the first scan">
          Repositories appear once an agent finishes walking its discovery folders.
        </EmptyState>
      )}
      {repositories.length > 0 && visible.length === 0 && (
        <p className="py-16 text-center text-sm text-ink-muted">No repositories match.</p>
      )}
      {visible.length > 0 && <FleetMatrix machines={machines} repositories={visible} />}
      {selected !== undefined && selectedMachine !== undefined && (
        <CheckoutDetail
          repository={selected.repository}
          machine={selectedMachine}
          checkout={selected.entry.checkout}
          onClose={() => {
            void navigate({ search: ({ checkout: _checkout, ...rest }) => rest });
          }}
        />
      )}
    </div>
  );
}
