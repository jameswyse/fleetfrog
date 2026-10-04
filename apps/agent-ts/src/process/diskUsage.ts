import { execFile } from "node:child_process";

import { Effect } from "effect";

const batchSize = 200;

function runDu(cwd: string, paths: ReadonlyArray<string>): Promise<Map<string, number>> {
  return new Promise((settle) => {
    execFile(
      "du",
      ["-sk", "--", ...paths],
      { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
      (_error, stdout) => {
        const sizes = new Map<string, number>();

        for (const line of stdout.split("\n")) {
          const tab = line.indexOf("\t");

          if (tab > 0) {
            sizes.set(line.slice(tab + 1), Number(line.slice(0, tab)) * 1024);
          }
        }

        settle(sizes);
      },
    );
  });
}

export const diskUsage = Effect.fn("diskUsage")(function* (
  cwd: string,
  paths: ReadonlyArray<string>,
) {
  const batches: Array<ReadonlyArray<string>> = [];

  for (let start = 0; start < paths.length; start += batchSize) {
    batches.push(paths.slice(start, start + batchSize));
  }

  const measured = yield* Effect.forEach(batches, (batch) =>
    Effect.promise(() => runDu(cwd, batch)),
  );

  const sizes = new Map(measured.flatMap((batch) => [...batch]));

  return paths.map((path) => sizes.get(path) ?? 0);
});
