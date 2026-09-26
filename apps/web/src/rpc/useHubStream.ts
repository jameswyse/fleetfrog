import { useEffect, useEffectEvent, useState } from "react";

import { Cause, Effect, Fiber, Result, Stream } from "effect";

import { describeCause, useHubClient } from "./hubConnection.ts";

import type { DashboardClient, DashboardError } from "./hubConnection.ts";

export type StreamState<A> =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly value: A }
  | { readonly _tag: "Failed"; readonly message: string };

/** A lost connection keeps the last value on screen until the stream reopens after reconnecting. */
function isConnectionLoss(cause: Cause.Cause<DashboardError>): boolean {
  const error = Cause.findError(cause);

  return (
    Cause.hasInterruptsOnly(cause) ||
    (Result.isSuccess(error) && error.success._tag === "RpcClientError")
  );
}

/**
 * Follows a hub stream while the component is mounted, reopening it after a reconnect. Changing
 * `key` opens a new stream, so it must identify everything `open` depends on.
 */
export function useHubStream<A>(options: {
  readonly key: string;
  readonly open: (client: DashboardClient) => Stream.Stream<A, DashboardError>;
}): StreamState<A> {
  const client = useHubClient();
  const [current, setCurrent] = useState<{ readonly key: string; readonly state: StreamState<A> }>({
    key: options.key,
    state: { _tag: "Loading" },
  });
  const open = useEffectEvent(options.open);
  const { key } = options;

  useEffect(() => {
    if (client === null) {
      return undefined;
    }

    const fiber = Effect.runFork(
      open(client).pipe(
        Stream.runForEach((value) =>
          Effect.sync(() => setCurrent({ key, state: { _tag: "Ready", value } })),
        ),
        Effect.catchCause((cause) =>
          isConnectionLoss(cause)
            ? Effect.void
            : Effect.sync(() =>
                setCurrent({ key, state: { _tag: "Failed", message: describeCause(cause) } }),
              ),
        ),
      ),
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [client, key]);

  return current.key === key ? current.state : { _tag: "Loading" };
}
