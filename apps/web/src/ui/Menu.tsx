import { useId } from "react";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/** The look of each entry, for buttons and links alike: an icon, then its words. */
export const menuItemClass =
  "flex w-full items-center gap-2.5 rounded px-3 py-2 text-start text-sm text-ink hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60";

/** The icon at the start of an entry, for links built from `menuItemClass`. */
export function MenuIcon({ children }: { readonly children: ReactNode }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 text-ink-muted">
      {children}
    </span>
  );
}

export function MenuItem({
  icon,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** An icon element, such as a Lucide icon. */
  readonly icon: ReactNode;
}) {
  return (
    <button type="button" className={`${menuItemClass} ${className}`} {...props}>
      <MenuIcon>{icon}</MenuIcon>
      {children}
    </button>
  );
}

const moreButtonClass =
  "-me-2 grid size-8 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink";

/**
 * A button that opens a list of entries beside it, by default a "more actions" button. It is a
 * native popover, so it closes on Escape or a click elsewhere, and it sits beside its button where
 * the browser can anchor it. Entries receive `close` to dismiss it after acting.
 */
export function Menu({
  label,
  trigger,
  children,
}: {
  /** Names the button, such as "Actions for shop". A trigger with words of its own can go without. */
  readonly label?: string;
  /** The button's visible content and look, in place of the "more" icon. */
  readonly trigger?: { readonly content: ReactNode; readonly className: string };
  readonly children: (close: () => void) => ReactNode;
}) {
  const menuId = useId();
  const close = () => document.getElementById(menuId)?.hidePopover();

  return (
    <>
      <button
        type="button"
        popoverTarget={menuId}
        aria-label={label}
        className={trigger?.className ?? moreButtonClass}
      >
        {trigger?.content ?? (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        )}
      </button>
      <div
        id={menuId}
        popover="auto"
        className="w-64 rounded-lg border border-line bg-surface p-1 text-ink shadow-xl supports-[position-area:bottom]:inset-auto supports-[position-area:bottom]:m-0 supports-[position-area:bottom]:[position-area:bottom_span-left] supports-[position-area:bottom]:[position-try-fallbacks:flip-inline,flip-block]"
      >
        {children(close)}
      </div>
    </>
  );
}
