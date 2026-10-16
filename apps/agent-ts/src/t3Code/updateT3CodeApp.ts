import { access, constants } from "node:fs/promises";
import path from "node:path";

import { Duration, Effect, Option, Predicate, Queue, Schema } from "effect";

import { isNewerT3Code } from "@fleetfrog/protocol/domain/t3CodeUpdate";

import { runExecutable } from "../process/runTool.ts";

export class T3CodeAppUpdateFailed extends Schema.TaggedError<
  T3CodeAppUpdateFailed,
  { readonly brand: unique symbol }
>()("T3CodeAppUpdateFailed", { message: Schema.String }) {}

const preparationTimeout = Duration.minutes(25);
const commitTimeout = Duration.minutes(2);
const requestTimeout = Duration.seconds(30);
const defaultConnectTimeout = Duration.seconds(30);

const closedEarly = "T3 Code's server closed the connection before the update was ready.";

const unsupported = "FleetFrog doesn't support updating this version of T3 Code's desktop app.";

const IssuedSession = Schema.fromJsonString(
  Schema.Struct({ sessionId: Schema.String, token: Schema.String }),
);

const Descriptor = Schema.Struct({
  serverVersion: Schema.String,
  orchestrationProtocolVersion: Schema.Literal(2),
  capabilities: Schema.Struct({
    serverSelfUpdate: Schema.Literal("desktop-managed"),
    desktopAppUpdate: Schema.Literal(true),
    serverSelfUpdateProgress: Schema.Literal(true),
  }),
});

const Ticket = Schema.Struct({ ticket: Schema.String });

const FailureReason = Schema.Struct({
  _tag: Schema.Literal("Fail"),
  error: Schema.Struct({ reason: Schema.String }),
});

const Exit = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success") }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), cause: Schema.Array(Schema.Unknown) }),
]);

const Envelope = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Ping") }),
  Schema.Struct({
    _tag: Schema.Literal("Chunk"),
    requestId: Schema.String,
    values: Schema.Array(Schema.Unknown),
  }),
  Schema.Struct({ _tag: Schema.Literal("Exit"), requestId: Schema.String, exit: Exit }),
]);
type Envelope = typeof Envelope.Type;

const UpdateEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("progress"),
    stage: Schema.Literals(["downloading", "installing"]),
  }),
  Schema.Struct({
    type: Schema.Literal("complete"),
    result: Schema.Struct({
      targetVersion: Schema.optionalKey(Schema.String),
      method: Schema.optionalKey(Schema.String),
      desktopUpdateToken: Schema.optionalKey(Schema.String),
    }),
  }),
]);

const decodeSession = Schema.decodeUnknownEffect(IssuedSession);
const decodeDescriptor = Schema.decodeUnknownOption(Descriptor);
const decodeTicket = Schema.decodeUnknownOption(Ticket);
const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);
const decodeFailureReason = Schema.decodeUnknownOption(FailureReason);
const decodeUpdateEvent = Schema.decodeUnknownOption(UpdateEvent);

const failed = (message: string) => new T3CodeAppUpdateFailed({ message });

interface PreparedOffer {
  current: { readonly targetVersion: string; readonly desktopUpdateToken: string } | null;
}

type Received = Envelope | { readonly _tag: "Closed" };

type CallEnd =
  | { readonly _tag: "Success" }
  | { readonly _tag: "Failure"; readonly reason: string | null }
  | { readonly _tag: "Closed" }
  | { readonly _tag: "NotSent" };

function envelopesIn(data: unknown): ReadonlyArray<Envelope> {
  const parsed = Predicate.isString(data) ? Option.getOrNull(decodeMessage(data)) : null;

  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((item) =>
    Option.toArray(decodeEnvelope(item)),
  );
}

function failureReason(cause: ReadonlyArray<unknown>): string | null {
  return (
    cause.flatMap((entry) => Option.toArray(decodeFailureReason(entry)))[0]?.error.reason ?? null
  );
}

interface Answer<A> {
  readonly status: number;
  readonly body: Option.Option<A>;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const request = <A>(
  url: string,
  decode: (json: unknown) => Option.Option<A>,
  init: RequestInit = {},
) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(url, { ...init, signal }).then(async (response): Promise<Answer<A>> => ({
        status: response.status,
        body: await response.json().then(decode, () => Option.none()),
      })),
    catch: (error) => failed(`Couldn't reach T3 Code's server: ${describe(error)}`),
  }).pipe(
    Effect.timeoutOrElse({
      duration: requestTimeout,
      orElse: () =>
        Effect.fail(failed("Couldn't reach T3 Code's server: it didn't answer within 30 seconds.")),
    }),
  );

const issueSession = (cli: string, home: string) =>
  Effect.acquireRelease(
    runExecutable(cli, [
      "auth",
      "session",
      "issue",
      "--base-dir",
      home,
      "--scope",
      "environment:maintain",
      "--scope",
      "orchestration:read",
      "--ttl",
      "30m",
      "--label",
      "FleetFrog",
      "--json",
    ]).pipe(
      Effect.mapError(({ message }) => failed(`Couldn't start a session in T3 Code: ${message}`)),
      Effect.flatMap((output) =>
        decodeSession(output).pipe(
          Effect.mapError(() =>
            failed(
              "Couldn't start a session in T3 Code: its command-line tool answered with something FleetFrog can't read.",
            ),
          ),
        ),
      ),
    ),
    ({ sessionId }) =>
      runExecutable(cli, ["auth", "session", "revoke", sessionId, "--base-dir", home]).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not revoke FleetFrog's T3 Code session", error.message),
        ),
        Effect.asVoid,
      ),
  );

const openSocket = (url: string, connectTimeout: Duration.Duration) =>
  Effect.gen(function* () {
    const received = yield* Queue.unbounded<Received>();

    const socket = yield* Effect.acquireRelease(
      Effect.callback<WebSocket, T3CodeAppUpdateFailed>((resume) => {
        const opening = new WebSocket(url);

        opening.addEventListener("message", ({ data }) => {
          for (const envelope of envelopesIn(data)) {
            Queue.offerUnsafe(received, envelope);
          }
        });
        opening.addEventListener("close", ({ code }) => {
          Queue.offerUnsafe(received, { _tag: "Closed" });
          resume(
            Effect.fail(
              failed(
                `Couldn't connect to T3 Code's server: it closed the connection with code ${code}.`,
              ),
            ),
          );
        });
        opening.addEventListener("open", () => resume(Effect.succeed(opening)));

        return Effect.sync(() => opening.close());
      }).pipe(
        Effect.timeoutOrElse({
          duration: connectTimeout,
          orElse: () =>
            Effect.fail(
              failed("Couldn't connect to T3 Code's server: it didn't answer within 30 seconds."),
            ),
        }),
      ),
      (open) => Effect.sync(() => open.close()),
      { interruptible: true },
    );

    const send = (message: unknown) => Effect.sync(() => socket.send(JSON.stringify(message)));

    const call = Effect.fnUntraced(function* (
      id: string,
      tag: string,
      payload: unknown,
      onValue: (value: unknown) => Effect.Effect<void, T3CodeAppUpdateFailed>,
    ): Effect.fn.Return<CallEnd, T3CodeAppUpdateFailed> {
      if (socket.readyState !== WebSocket.OPEN) {
        return { _tag: "NotSent" };
      }

      yield* send({ _tag: "Request", id, tag, payload, headers: [] });

      for (;;) {
        const message = yield* Queue.take(received);

        if (message._tag === "Closed") {
          return { _tag: "Closed" };
        }

        if (message._tag === "Ping") {
          yield* send({ _tag: "Pong" });
        } else if (message.requestId !== id) {
          continue;
        } else if (message._tag === "Chunk") {
          yield* send({ _tag: "Ack", requestId: id });
          yield* Effect.forEach(message.values, onValue, { discard: true });
        } else {
          return message.exit._tag === "Success"
            ? { _tag: "Success" }
            : { _tag: "Failure", reason: failureReason(message.exit.cause) };
        }
      }
    });

    return { call };
  });

export const updateT3CodeApp = Effect.fn("updateT3CodeApp")(function* <E>(options: {
  readonly home: string;
  readonly port: number;
  readonly version: string;
  readonly recheck: Effect.Effect<void, E>;
  readonly connectTimeout?: Duration.Duration;
}) {
  const cli = path.join(options.home, "bin", "t3");

  const executable = yield* Effect.promise(() =>
    access(cli, constants.X_OK).then(
      () => true,
      () => false,
    ),
  );

  if (!executable) {
    return yield* failed(`Couldn't find T3 Code's command-line tool at ${cli}.`);
  }

  const { token } = yield* issueSession(cli, options.home);
  const origin = `127.0.0.1:${options.port}`;

  const descriptor = yield* request(
    `http://${origin}/.well-known/t3/environment`,
    decodeDescriptor,
  );

  if (descriptor.status !== 200 || Option.isNone(descriptor.body)) {
    return yield* failed(unsupported);
  }

  const runningVersion = descriptor.body.value.serverVersion;

  const ticket = yield* request(`http://${origin}/api/auth/websocket-ticket`, decodeTicket, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

  if (ticket.status !== 200 || Option.isNone(ticket.body)) {
    return yield* failed(
      `Couldn't reach T3 Code's server: it answered the ticket request with HTTP ${ticket.status}.`,
    );
  }

  const { call } = yield* openSocket(
    `ws://${origin}/ws?orchestrationProtocol=2&wsTicket=${encodeURIComponent(ticket.body.value.ticket)}`,
    options.connectTimeout ?? defaultConnectTimeout,
  );

  const offer: PreparedOffer = { current: null };

  const prepared = yield* call(
    "1",
    "server.updateServerWithProgress",
    { targetVersion: options.version },
    (value) =>
      Option.match(decodeUpdateEvent(value), {
        onNone: () => Effect.void,
        onSome: (event) => {
          if (event.type === "progress") {
            return Effect.logInfo(`T3 Code's app is ${event.stage} the update`);
          }

          const { method, targetVersion, desktopUpdateToken } = event.result;

          if (
            method !== "desktop-app" ||
            targetVersion === undefined ||
            desktopUpdateToken === undefined
          ) {
            return Effect.fail(failed(unsupported));
          }

          offer.current = { targetVersion, desktopUpdateToken };

          return Effect.void;
        },
      }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: preparationTimeout,
      orElse: () =>
        Effect.fail(failed("T3 Code's app took longer than 25 minutes to prepare the update.")),
    }),
  );

  if (prepared._tag === "Failure") {
    return yield* failed(prepared.reason ?? "T3 Code's app couldn't prepare the update.");
  }

  if (prepared._tag === "Closed" || prepared._tag === "NotSent") {
    return yield* failed(closedEarly);
  }

  if (offer.current === null) {
    return yield* failed(unsupported);
  }

  const { targetVersion, desktopUpdateToken } = offer.current;

  if (!isNewerT3Code(targetVersion, runningVersion)) {
    return yield* failed(
      `T3 Code's app offered ${targetVersion}, which isn't newer than ${runningVersion}.`,
    );
  }

  yield* options.recheck;

  const committed = yield* call(
    "2",
    "server.commitDesktopUpdate",
    { requestId: desktopUpdateToken },
    () => Effect.void,
  ).pipe(
    Effect.timeoutOrElse({
      duration: commitTimeout,
      orElse: () =>
        Effect.fail(failed("T3 Code's app didn't start installing the update within 2 minutes.")),
    }),
  );

  if (committed._tag === "NotSent") {
    return yield* failed(closedEarly);
  }

  if (committed._tag === "Failure") {
    return yield* failed(committed.reason ?? "T3 Code's app couldn't install the update.");
  }

  return targetVersion;
}, Effect.scoped);
