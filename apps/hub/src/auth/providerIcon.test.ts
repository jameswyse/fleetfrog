import { createServer } from "node:http";

import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate } from "effect";

import { fetchProviderIcon, iconType } from "./providerIcon.ts";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00, 1, 2, 3]);

const site = (pages: Record<string, { type: string; body: string | Uint8Array }>) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ url: string; close: () => void }>((resolve) => {
          const server = createServer((request, response) => {
            const page = pages[request.url ?? ""];

            response.writeHead(page === undefined ? 404 : 200, {
              "content-type": page?.type ?? "text/plain",
            });
            response.end(page?.body ?? "");
          });

          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = Predicate.isObject(address) ? address.port : 0;

            resolve({ url: `http://127.0.0.1:${String(port)}`, close: () => server.close() });
          });
        }),
    ),
    ({ close }) => Effect.sync(close),
  );

it.effect("takes the icon a provider's page links to, preferring the home-screen one", () =>
  Effect.gen(function* () {
    const { url } = yield* site({
      "/": {
        type: "text/html",
        body: `<html><head>
          <link rel="shortcut icon" href="/favicon.ico">
          <link href='/static/touch.png' rel="apple-touch-icon">
        </head></html>`,
      },
      "/static/touch.png": { type: "image/png", body: png },
      "/favicon.ico": { type: "image/x-icon", body: ico },
    });

    expect(yield* fetchProviderIcon(`${url}/application/o/fleetfrog/`)).toEqual(
      Option.some({ data: png, mediaType: "image/png" }),
    );
  }).pipe(Effect.scoped),
);

it.effect("falls back to /favicon.ico, and finds nothing on a site without icons", () =>
  Effect.gen(function* () {
    const withFavicon = yield* site({ "/favicon.ico": { type: "image/x-icon", body: ico } });
    const bare = yield* site({ "/": { type: "text/html", body: "<html></html>" } });

    expect(yield* fetchProviderIcon(withFavicon.url)).toEqual(
      Option.some({ data: ico, mediaType: "image/x-icon" }),
    );
    expect(yield* fetchProviderIcon(bare.url)).toEqual(Option.none());
  }).pipe(Effect.scoped),
);

it("reads the image type from its bytes and refuses anything else", () => {
  expect(iconType(png)).toBe("image/png");
  expect(iconType(new TextEncoder().encode(' <?xml version="1.0"?><svg/>'))).toBe("image/svg+xml");
  expect(iconType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  expect(iconType(new Uint8Array(300 * 1024).fill(0x89))).toBeNull();
});
