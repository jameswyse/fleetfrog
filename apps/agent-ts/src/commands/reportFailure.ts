import { Console, Effect } from "effect";

/** Explains an expected failure on standard error and marks the process as failed. */
export function reportFailure(message: string) {
  return Console.error(message).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    ),
  );
}
