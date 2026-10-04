import { Effect } from "effect";
import { HttpIncomingMessage, HttpRouter } from "effect/http";

import type { ByteSize } from "effect";

export function bodyLimit(limit: ByteSize.ByteSize) {
  return HttpRouter.middleware(
    (httpEffect) => Effect.provideService(httpEffect, HttpIncomingMessage.MaxBodySize, limit),
    { global: true },
  );
}
