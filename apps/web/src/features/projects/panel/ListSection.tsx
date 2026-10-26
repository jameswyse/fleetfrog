import { useId } from "react";

import type { ReactNode } from "react";

export const sectionTitleClass = "text-xs font-semibold tracking-wide text-ink-muted uppercase";

export const shortListInCard = { listClassName: "", footerClassName: "mb-1.5 px-2" } as const;

export function CountPill({ count }: { readonly count: number }) {
  return (
    <span className="rounded-full bg-chip px-1.5 text-xs font-medium text-ink-muted tabular-nums">
      {count}
    </span>
  );
}

export function ListCard({ children }: { readonly children: ReactNode }) {
  return <div className="rounded-xl border border-line p-1">{children}</div>;
}

export function ListSection({
  title,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-1.5 flex min-h-7 items-center gap-2 px-1.5">
        <h3 id={headingId} className={sectionTitleClass}>
          {title}
        </h3>
        {count !== undefined && <CountPill count={count} />}
        <span className="flex-1" />
        {action}
      </div>
      <ListCard>{children}</ListCard>
    </section>
  );
}
