import { Effect } from "effect";
import { HttpIncomingMessage, HttpRouter } from "effect/http";

import type { ByteSize } from "effect";

/**
 * Stops reading a request body past the limit, so a flood of large bodies can't take the hub's
 * memory. Each server gets its own, since a layer is built once however many routers it joins.
 */
export function bodyLimit(limit: ByteSize.ByteSize) {
  return HttpRouter.middleware(
    (httpEffect) => Effect.provideService(httpEffect, HttpIncomingMessage.MaxBodySize, limit),
    { global: true },
  );
}
