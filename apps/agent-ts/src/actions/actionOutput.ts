import { redactCredentials } from "../process/redactCredentials.ts";

/** How many of Git's last lines travel with an action's outcome. */
const keptLines = 50;

/** A line is cut here, so output with no line breaks can't grow without limit. */
const lineLimit = 64 * 1024;

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
        } else if (current.length < lineLimit) {
          current += part.slice(0, lineLimit - current.length);
        }
      }
    },
    /** The line Git is drawing now, or the last one it finished, with any credentials removed. */
    progress: (): string | null => {
      const line = (current || drawn || lines.at(-1)) ?? null;

      return line === null ? null : redactCredentials(line);
    },
    /** The last lines, including any unfinished one, with any credentials removed. */
    tail: (): ReadonlyArray<string> => {
      const pending = current === "" ? drawn : current;

      return (pending === "" ? lines : [...lines, pending])
        .slice(-keptLines)
        .map(redactCredentials);
    },
  };
}

export type ActionOutput = ReturnType<typeof makeActionOutput>;
