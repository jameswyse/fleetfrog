import { Link } from "@tanstack/react-router";

import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** A sidebar entry: an icon, its label and anything trailing, highlighted on its own page. */
export const sidebarLinkClass =
  "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink";

/**
 * A list nested under a sidebar entry, its connecting line starting under the centre of the entry's
 * icon.
 */
export const sidebarSubmenuClass = "ms-[17px] mt-0.5 space-y-0.5";

/**
 * An entry in a nested list, joined to the line by a curved branch at its middle. The line runs on
 * past every entry but the last, where the branch ends it, and the first reaches up to the entry
 * above.
 */
export const sidebarSubmenuItemClass =
  "relative ps-3 before:absolute before:start-0 before:top-0 before:-bottom-0.5 before:w-px before:bg-line last:before:hidden after:absolute after:start-0 after:top-0 after:h-[18px] after:w-2.5 after:rounded-es-md after:border-s after:border-b after:border-line first:before:-top-2.5 first:after:-top-2.5 first:after:h-[28px]";

/**
 * A sidebar under the main header, beside the current page. On wide screens the sidebar stays in
 * place below the header while the page scrolls.
 */
export function SidebarLayout({
  sidebar,
  children,
}: {
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:w-64 md:shrink-0 md:border-e md:border-b-0 lg:sticky lg:top-(--app-header-height) lg:h-[calc(100dvh-var(--app-header-height))] lg:overflow-y-auto">
        {sidebar}
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * One page beside a sidebar: a bar with its name, after any pages it sits under, and any page-wide
 * action, above its content.
 */
export function SidebarPage({
  title,
  parents = [],
  action,
  aside,
  children,
}: {
  readonly title: string;
  /** The pages above this one, outermost first, shown as a breadcrumb before its name. */
  readonly parents?: ReadonlyArray<{
    readonly label: string;
    readonly to: NonNullable<LinkProps["to"]>;
  }>;
  readonly action?: ReactNode;
  /** Supporting facts, shown in a column beside the page on wide screens and after it otherwise. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-8">
        {parents.length === 0 ? (
          <h1 className="min-w-0 text-base font-semibold">{title}</h1>
        ) : (
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex flex-wrap items-center gap-x-2 text-base">
              {parents.map((parent) => (
                <li key={parent.label} className="flex items-center gap-x-2">
                  <Link
                    to={parent.to}
                    activeOptions={{ exact: true }}
                    className="text-ink-muted hover:text-ink hover:underline"
                  >
                    {parent.label}
                  </Link>
                  <span aria-hidden="true" className="text-ink-muted">
                    /
                  </span>
                </li>
              ))}
              <li aria-current="page">
                <h1 className="font-semibold">{title}</h1>
              </li>
            </ol>
          </nav>
        )}
        {action !== undefined && <div className="ms-auto">{action}</div>}
      </div>
      <div className="flex flex-col gap-8 px-4 py-8 sm:px-8 xl:flex-row xl:items-start">
        <div className="min-w-0 space-y-8 xl:flex-1">{children}</div>
        {aside !== undefined && <aside className="space-y-6 xl:w-96 xl:shrink-0">{aside}</aside>}
      </div>
    </>
  );
}
