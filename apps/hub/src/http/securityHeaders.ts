import { createHash } from "node:crypto";

import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requestHost } from "./serveSocket.ts";

/** A host a browser could have asked for, so the policy quotes nothing else. */
const hostPattern = /^[\w.:[\]-]+$/u;

/**
 * The hashes of a page's inline scripts in the form a Content-Security-Policy takes, so the
 * policy allows just those scripts and nothing injected into the page.
 */
export function inlineScriptHashes(html: string): ReadonlyArray<string> {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
    .filter(([, attributes = ""]) => !/\bsrc\s*=/iu.test(attributes))
    .map(
      ([, , body = ""]) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
    );
}

/**
 * The dashboard runs scripts only from its own files, and talks only to its own origin, with the
 * socket named outright for browsers whose `'self'` leaves out WebSockets. Pictures may come from
 * the sign-in provider or Gravatar, on any site, and small images are built into the page as
 * `data:` URLs.
 */
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

/**
 * Headers on every dashboard response that keep other sites from framing it, keep browsers from
 * running anything but its own scripts, and keep its address out of the requests it makes
 * elsewhere. A response that already carries a policy, such as an uploaded image's sandbox,
 * keeps it.
 */
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
