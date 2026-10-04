import { redactCredentials } from "../process/redactCredentials.ts";

const keptLines = 50;

const lineLimit = 64 * 1024;

export function makeActionOutput() {
  const lines: Array<string> = [];
  let current = "";
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
    progress: (): string | null => {
      const line = (current || drawn || lines.at(-1)) ?? null;

      return line === null ? null : redactCredentials(line);
    },
    tail: (): ReadonlyArray<string> => {
      const pending = current === "" ? drawn : current;

      return (pending === "" ? lines : [...lines, pending])
        .slice(-keptLines)
        .map(redactCredentials);
    },
  };
}

export type ActionOutput = ReturnType<typeof makeActionOutput>;
