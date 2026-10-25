import { useId } from "react";

import type { ReactNode } from "react";

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
      <div className="flex min-h-7 items-center gap-2 px-1.5">
        <h3 id={headingId} className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          {title}
        </h3>
        {count !== undefined && (
          <span className="rounded-full bg-canvas px-1.5 text-xs font-medium text-ink-muted tabular-nums">
            {count}
          </span>
        )}
        <span className="flex-1" />
        {action}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}
