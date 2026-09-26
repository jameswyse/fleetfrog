import { XIcon } from "lucide-react";

import type { ReactNode } from "react";

/** The top of the side panel: an optional way back, the heading, and a close button if it closes. */
export function PanelHeader({
  headingId,
  title,
  subtitle,
  back,
  actions,
  onClose,
}: {
  /** Labels the panel, and takes focus when the panel covers the page. */
  readonly headingId: string;
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly back?: ReactNode;
  readonly actions?: ReactNode;
  readonly onClose?: () => void;
}) {
  return (
    <div className="px-5 pt-4 pb-4">
      {back}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            tabIndex={-1}
            className="text-base font-semibold break-words outline-none"
          >
            {title}
          </h2>
          {subtitle !== undefined && (
            <div className="mt-0.5 text-sm text-ink-muted">{subtitle}</div>
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
