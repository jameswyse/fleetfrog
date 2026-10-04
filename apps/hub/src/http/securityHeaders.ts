import { createHash } from "node:crypto";

import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requestHost } from "./serveSocket.ts";

const hostPattern = /^[\w.:[\]-]+$/u;

export function inlineScriptHashes(html: string): ReadonlyArray<string> {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/giu)].flatMap(
    ([, attributes = "", body = ""]) =>
      /\bsrc\s*=/iu.test(attributes)
        ? []
        : [`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`],
  );
}

function contentSecurityPolicy(
  host: Option.Option<string>,
  scriptHashes: ReadonlyArray<string>,
): string {
  const sockets = host.pipe(
    Option.filter((value) => hostPattern.test(value)),
    Option.map((value) => ` ws://${value} wss://${value}`),
    Option.getOrElse(() => ""),
  );

  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes].join(" "),
    "style-src 'self'",
    "img-src 'self' data: https: http:",
    `connect-src 'self'${sockets}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(options: { readonly scriptHashes: ReadonlyArray<string> }) {
  return HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* httpEffect;

        return HttpServerResponse.setHeaders(response, {
          "content-security-policy":
            response.headers["content-security-policy"] ??
            contentSecurityPolicy(requestHost(request), options.scriptHashes),
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
          "cross-origin-opener-policy": "same-origin",
        });
      }),
    { global: true },
  );
}
