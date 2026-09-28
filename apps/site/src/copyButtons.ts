/** How long a copy button shows its tick, in milliseconds. */
const copiedDuration = 2000;

/** Lets each command's button copy it, confirming with a tick and through the status message. */
export function enableCopyButtons(status: HTMLElement): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const code = button.closest(".command")?.querySelector("code");
    let hideTick = 0;

    button.addEventListener("click", async () => {
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
    });
  }
}
