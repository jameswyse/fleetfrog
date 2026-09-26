import { useEffect } from "react";

/**
 * Moves focus to the panel's heading when the panel covers the page on narrow screens, or when
 * whatever had focus went away with the panel's previous contents. It acts when it mounts, so
 * keying it on what the panel shows makes it act each time that changes.
 */
export function FocusHeading({ targetId }: { readonly targetId: string }) {
  useEffect(() => {
    const focusLost = document.activeElement === null || document.activeElement === document.body;

    if (focusLost || !window.matchMedia("(min-width: 64rem)").matches) {
      document.getElementById(targetId)?.focus();
    }
  }, [targetId]);

  return null;
}
