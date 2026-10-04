const copiedDuration = 2000;

export function enableCopyButtons(status: HTMLElement): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const code = button.closest(".command")?.querySelector("code");
    let hideTick = 0;

    const copy = async () => {
      if (code === null || code === undefined) {
        return;
      }

      try {
        await navigator.clipboard.writeText(code.textContent);
        status.textContent = "Copied to the clipboard.";
        button.toggleAttribute("data-copied", true);
        clearTimeout(hideTick);
        hideTick = window.setTimeout(
          () => button.toggleAttribute("data-copied", false),
          copiedDuration,
        );
      } catch {
        status.textContent = "Unable to copy. Select the command and copy it instead.";
      }
    };

    button.addEventListener("click", () => void copy());
  }
}
