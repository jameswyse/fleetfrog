import type { ReactNode } from "react";

/** A settings page's title and summary, with any page-wide action at the trailing edge. */
export function SettingsHeading({
  title,
  children,
  action,
}: {
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="mt-1 text-sm text-ink-muted">{children}</div>
      </div>
      {action}
    </div>
  );
}
