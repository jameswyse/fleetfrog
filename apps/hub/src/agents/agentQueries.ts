import { randomUUID } from "node:crypto";

import { Deferred, Effect } from "effect";

import type { Duration } from "effect";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

/**
 * Commands whose answers arrive separately, matched by a request id. Each question waits for its
 * answer until a timeout, and only the machine that was asked can answer it.
 */
export function makeAgentQueries<Answer>(options: {
  /** How long an agent may take before it counts as having gone quiet. */
  readonly timeout: Duration.Input;
  /** The answer to give when the machine is offline or doesn't answer in time. */
  readonly unanswered: (message: string) => Answer;
}) {
  const pending = new Map<
    string,
    { readonly machineId: MachineId; readonly answer: Deferred.Deferred<Answer> }
  >();

  return {
    /**
     * Sends a command carrying a new request id and waits for its answer. `send` returns null when
     * the machine is offline.
     */
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
          // An answer that never comes, or comes too late, leaves nothing behind.
          Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
        );
      }),
    /** Takes an agent's answer. Answers from another machine or to no question are ignored. */
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
