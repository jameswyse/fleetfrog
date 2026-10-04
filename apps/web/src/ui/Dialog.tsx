import { useId, useRef } from "react";

import type { ReactNode } from "react";

export function Dialog({
  title,
  onClose,
  children,
  placement = "centre",
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly placement?: "centre" | "side";
}) {
  const titleId = useId();
  const opener = useRef<Element | null>(null);

  const position =
    placement === "side"
      ? "ms-auto me-0 h-dvh max-h-dvh w-full max-w-2xl rounded-none border-s"
      : "m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border";

  return (
    <dialog
      ref={(node) => {
        if (node === null) {
          return undefined;
        }

        if (!node.open) {
          opener.current = document.activeElement;
          node.showModal();
        }

        return () => {
          queueMicrotask(() => {
            if (!node.isConnected && opener.current instanceof HTMLElement) {
              opener.current.focus();
            }
          });
        };
      }}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`overscroll-contain border-line bg-surface p-0 text-ink shadow-2xl ${position}`}
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-9 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
