/** How many of Git's last lines travel with an action's outcome. */
const keptLines = 50;

/**
 * Collects Git's output for an action. Git redraws progress in place with carriage returns, so a
 * line is finished by `\n` and redrawn after `\r`, and only its final form is kept.
 */
export function makeActionOutput() {
  const lines: Array<string> = [];
  let current = "";
  /** The last complete drawing of the current line, kept while Git redraws it. */
  let drawn = "";

  const finishLine = () => {
    const line = current === "" ? drawn : current;

    if (line !== "") {
      lines.push(line);

      if (lines.length > keptLines) {
        lines.shift();
      }
    }

    current = "";
    drawn = "";
  };

  return {
    write: (text: string) => {
      for (const part of text.split(/(\r|\n)/)) {
        if (part === "\n") {
          finishLine();
        } else if (part === "\r") {
          drawn = current === "" ? drawn : current;
          current = "";
        } else {
          current += part;
        }
      }
    },
    /** The line Git is drawing now, or the last one it finished. */
    progress: (): string | null => (current || drawn || lines.at(-1)) ?? null,
    /** The last lines, including any unfinished one. */
    tail: (): ReadonlyArray<string> => {
      const pending = current === "" ? drawn : current;

      return (pending === "" ? lines : [...lines, pending]).slice(-keptLines);
    },
  };
}

export type ActionOutput = ReturnType<typeof makeActionOutput>;
