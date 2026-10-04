import { Option } from "effect";
import { Headers } from "effect/http";

import { requestHost } from "./serveSocket.ts";

import type { HttpServerRequest } from "effect/http";

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
