import { useEffect } from "react";

export function FocusHeading({ targetId }: { readonly targetId: string }) {
  useEffect(() => {
    const focusLost = document.activeElement === null || document.activeElement === document.body;

    if (focusLost || !window.matchMedia("(min-width: 64rem)").matches) {
      document.getElementById(targetId)?.focus();
    }
  }, [targetId]);

  return null;
}
