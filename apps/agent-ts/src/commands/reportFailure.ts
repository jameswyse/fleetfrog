import { Console, Effect } from "effect";

export function reportFailure(message: string) {
  return Console.error(message).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    ),
  );
}
