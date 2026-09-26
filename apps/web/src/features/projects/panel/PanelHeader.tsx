import { XIcon } from "lucide-react";

import type { ReactNode } from "react";

/** The top of the side panel, pinned while the rest scrolls. */
export function PanelHeader({
  headingId,
  title,
  subtitle,
  actions,
  onClose,
}: {
  /** Labels the panel, and takes focus when the panel covers the page. */
  readonly headingId: string;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  readonly onClose?: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 mb-4 border-b border-line bg-surface px-5 py-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            tabIndex={-1}
            className="flex min-w-0 items-center gap-1.5 text-base font-semibold outline-none"
          >
            {title}
          </h2>
          {subtitle !== undefined && (
            <div className="mt-0.5 truncate text-sm text-ink-muted">{subtitle}</div>
          )}
        </div>
        {actions}
        {onClose !== undefined && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-me-2 grid size-8 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <XIcon />
          </button>
        )}
      </div>
    </div>
  );
}

/** One step of a breadcrumb heading, followed by a slash when another comes after it. */
export function Crumb({
  children,
  last = false,
}: {
  readonly children: ReactNode;
  readonly last?: boolean;
}) {
  return (
    <>
      <span className={`flex min-w-0 items-center gap-1.5 ${last ? "shrink-0" : "text-ink-muted"}`}>
        {children}
      </span>
      {!last && (
        <span aria-hidden="true" className="font-normal text-ink-muted">
          /
        </span>
      )}
    </>
  );
}
