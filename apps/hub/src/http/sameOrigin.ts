import { Option } from "effect";
import { Headers } from "effect/unstable/http";

import { requestHost } from "./serveSocket.ts";

import type { HttpServerRequest } from "effect/unstable/http";

/**
 * Whether a browser sent the request from a page on another origin. Browsers let any page open a
 * WebSocket or post a form to any address, so the dashboard's socket and sign-in routes accept
 * only pages served from the same origin. Clients that send no `Origin` are not browsers.
 */
export function isCrossOrigin(request: HttpServerRequest.HttpServerRequest): boolean {
  const origin = Headers.get(request.headers, "origin");

  if (Option.isNone(origin)) {
    return false;
  }

  return (
    !URL.canParse(origin.value) ||
    new URL(origin.value).host !== requestHost(request).pipe(Option.getOrElse(() => ""))
  );
}
