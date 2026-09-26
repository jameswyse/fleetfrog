import type { ReactNode } from "react";

/** A sidebar entry: an icon, its label and anything trailing, highlighted on its own page. */
export const sidebarLinkClass =
  "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink";

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

/** One page beside a sidebar: a bar with its name and any page-wide action, above its content. */
export function SidebarPage({
  title,
  action,
  aside,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  /** Supporting facts, shown in a column beside the page on wide screens and after it otherwise. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-8">
        <h1 className="min-w-0 text-base font-semibold">{title}</h1>
        {action !== undefined && <div className="ms-auto">{action}</div>}
      </div>
      <div className="flex flex-col gap-8 px-4 py-8 sm:px-8 xl:flex-row xl:items-start">
        <div className="min-w-0 space-y-8 xl:flex-1">{children}</div>
        {aside !== undefined && <aside className="space-y-6 xl:w-96 xl:shrink-0">{aside}</aside>}
      </div>
    </>
  );
}
