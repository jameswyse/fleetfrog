import { Link } from "@tanstack/react-router";

import type { ReactNode } from "react";

type Crumb =
  | { readonly label: string; readonly to: "/settings/fleet" }
  | { readonly label: string; readonly to?: never };

/**
 * One settings page: a top bar naming where it sits, with any page-wide action at its trailing
 * edge, above the page's sections.
 */
export function SettingsPage({
  trail,
  action,
  children,
}: {
  /** The sections above this page, ending with the page itself. */
  readonly trail: ReadonlyArray<Crumb>;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const current = trail.at(-1);

  return (
    <>
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-8">
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex flex-wrap items-center gap-x-2 text-sm">
            <li className="text-ink-muted">Settings</li>
            {trail.map((crumb) => (
              <li key={crumb.label} className="flex items-center gap-x-2">
                <span aria-hidden="true" className="text-ink-muted">
                  /
                </span>
                {crumb.to === undefined || crumb === current ? (
                  <span
                    aria-current={crumb === current ? "page" : undefined}
                    className={crumb === current ? "font-medium text-ink" : "text-ink-muted"}
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link to={crumb.to} className="text-ink-muted hover:text-ink hover:underline">
                    {crumb.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {action !== undefined && <div className="ms-auto">{action}</div>}
      </div>
      {current !== undefined && <h1 className="sr-only">{current.label}</h1>}
      <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 sm:px-8">{children}</div>
    </>
  );
}

/** A labelled group of rows in one card. */
export function SettingsSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm text-ink-muted">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting: what it is on the leading side and its control on the trailing side, with room
 * below for anything wider, such as a list or an error.
 */
export function SettingsRow({
  title,
  description,
  htmlFor,
  control,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Makes the title the label of this input. */
  readonly htmlFor?: string;
  readonly control?: ReactNode;
  readonly children?: ReactNode;
}) {
  const Title = htmlFor === undefined ? "p" : "label";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-1 basis-64">
        <Title htmlFor={htmlFor} className="block text-sm font-medium">
          {title}
        </Title>
        {description !== undefined && (
          <p
            id={htmlFor === undefined ? undefined : `${htmlFor}-description`}
            className="mt-0.5 text-sm text-ink-muted"
          >
            {description}
          </p>
        )}
      </div>
      {control !== undefined && <div className="shrink-0">{control}</div>}
      {children !== undefined && <div className="basis-full">{children}</div>}
    </div>
  );
}

/** Read-only facts, one per row, with the value on the trailing side. */
export function DetailList({ children }: { readonly children: ReactNode }) {
  return <dl className="divide-y divide-line">{children}</dl>;
}

export function DetailRow({
  term,
  note,
  children,
}: {
  readonly term: string;
  /** A qualifier under the term, such as when a value was measured. */
  readonly note?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3.5 text-sm">
      <dt className="text-ink-muted">
        {term}
        {note !== undefined && <span className="block text-xs">{note}</span>}
      </dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  );
}

/** The last row of a card, holding its submit button and outcome. */
export function SettingsFooter({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 bg-surface-raised px-5 py-3">
      {children}
    </div>
  );
}
