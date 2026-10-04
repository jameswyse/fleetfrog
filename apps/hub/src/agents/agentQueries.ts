import { randomUUID } from "node:crypto";

import { Deferred, Effect } from "effect";

import type { Duration } from "effect";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

export function makeAgentQueries<Answer>(options: {
  readonly timeout: Duration.Input;
  readonly unanswered: (message: string) => Answer;
}) {
  const pending = new Map<
    string,
    { readonly machineId: MachineId; readonly answer: Deferred.Deferred<Answer> }
  >();

  return {
    ask: (
      machineId: MachineId,
      send: (requestId: string) => Effect.Effect<string | null>,
    ): Effect.Effect<Answer> =>
      Effect.gen(function* () {
        const requestId = randomUUID();
        const answer = yield* Deferred.make<Answer>();

        pending.set(requestId, { machineId, answer });

        return yield* send(requestId).pipe(
          Effect.flatMap((sent) =>
            sent === null
              ? Effect.succeed(options.unanswered("The machine is offline."))
              : Deferred.await(answer).pipe(
                  Effect.timeoutOrElse({
                    duration: options.timeout,
                    orElse: () =>
                      Effect.succeed(options.unanswered("The machine didn't answer in time.")),
                  }),
                ),
          ),
          Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
        );
      }),
    answer: (answer: {
      readonly machineId: MachineId;
      readonly requestId: string;
      readonly value: Answer;
    }): Effect.Effect<void> =>
      Effect.suspend(() => {
        const request = pending.get(answer.requestId);

        if (request === undefined || request.machineId !== answer.machineId) {
          return Effect.void;
        }

        pending.delete(answer.requestId);

        return Deferred.succeed(request.answer, answer.value).pipe(Effect.asVoid);
      }),
  };
}
