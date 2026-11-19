import { createServer } from "node:http";

import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Option, Predicate, SubscriptionRef } from "effect";

import { TestDatabase } from "../persistence/testDatabase.ts";
import { fetchProviderIcon, iconType, ProviderIconStore } from "./providerIcon.ts";

import type { ProviderIconSource } from "@fleetfrog/protocol/domain/user";

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

    expect(yield* fetchProviderIcon(`${url}/application/o/fleetfrog/`)).toStrictEqual(
      Option.some({ data: png, mediaType: "image/png" }),
    );
  }).pipe(Effect.scoped),
);

it.effect("falls back to /favicon.ico, and finds nothing on a site without icons", () =>
  Effect.gen(function* () {
    const withFavicon = yield* site({ "/favicon.ico": { type: "image/x-icon", body: ico } });
    const bare = yield* site({ "/": { type: "text/html", body: "<html></html>" } });

    expect(yield* fetchProviderIcon(withFavicon.url)).toStrictEqual(
      Option.some({ data: ico, mediaType: "image/x-icon" }),
    );
    expect(yield* fetchProviderIcon(bare.url)).toStrictEqual(Option.none());
  }).pipe(Effect.scoped),
);

const stalledSite = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{
        url: string;
        requested: Promise<void>;
        abandoned: Promise<void>;
        close: () => void;
      }>((resolve) => {
        let markRequested = () => {};
        let markAbandoned = () => {};
        const requested = new Promise<void>((done) => (markRequested = done));
        const abandoned = new Promise<void>((done) => (markAbandoned = done));

        const server = createServer((request) => {
          request.socket.once("close", markAbandoned);
          markRequested();
        });

        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const port = Predicate.isObject(address) ? address.port : 0;

          resolve({
            url: `http://127.0.0.1:${String(port)}`,
            requested,
            abandoned,
            close: () => server.close(),
          });
        });
      }),
  ),
  ({ close }) => Effect.sync(close),
);

it.live("abandons a download when the request is cancelled", () =>
  Effect.gen(function* () {
    const provider = yield* stalledSite;
    const discovery = yield* Effect.forkChild(fetchProviderIcon(provider.url));

    yield* Effect.promise(() => provider.requested);
    yield* Fiber.interrupt(discovery);
    yield* Effect.promise(() => provider.abandoned).pipe(Effect.timeout(Duration.seconds(2)));
  }).pipe(Effect.scoped),
);

it("reads the image type from its bytes and refuses anything else", () => {
  expect(iconType(png)).toBe("image/png");
  expect(iconType(new TextEncoder().encode(' <?xml version="1.0"?><svg/>'))).toBe("image/svg+xml");
  expect(iconType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  expect(iconType(new Uint8Array(300 * 1024).fill(0x89))).toBeNull();
});

const storedIcon = (source: ProviderIconSource, byte: number) => ({
  mediaType: "image/png" as const,
  data: Uint8Array.of(byte),
  source,
});

const uploadedIcon = (byte: number) => storedIcon("uploaded", byte);

const TestIconStore = ProviderIconStore.layer.pipe(Layer.provide(TestDatabase));

it.effect("replaces and clears the stored icon", () =>
  Effect.gen(function* () {
    const icons = yield* ProviderIconStore;

    yield* icons.replace(uploadedIcon(1));
    yield* icons.replace(uploadedIcon(2));

    const replacedId = (yield* SubscriptionRef.get(icons.current))?.id ?? "";

    expect(Option.getOrUndefined(yield* icons.find(replacedId))?.data).toStrictEqual(
      Uint8Array.of(2),
    );

    yield* icons.replace(null);

    expect(yield* SubscriptionRef.get(icons.current)).toBeNull();
    expect(Option.isNone(yield* icons.find(replacedId))).toBe(true);
  }).pipe(Effect.provide(TestIconStore)),
);

it.effect("replaces the icon only while it is still the one the caller expected", () =>
  Effect.gen(function* () {
    const icons = yield* ProviderIconStore;

    const storedBytes = (id: string) =>
      icons
        .find(id)
        .pipe(Effect.map(Option.match({ onNone: () => null, onSome: ({ data }) => data })));

    const beforeUpload = yield* SubscriptionRef.get(icons.current);

    yield* icons.replace(uploadedIcon(1));

    const uploaded = yield* SubscriptionRef.get(icons.current);

    yield* icons.replaceIfCurrent(beforeUpload, storedIcon("provider", 2));

    expect(yield* SubscriptionRef.get(icons.current)).toStrictEqual(uploaded);
    expect(yield* storedBytes(uploaded?.id ?? "")).toStrictEqual(Uint8Array.of(1));

    yield* icons.replaceIfCurrent(uploaded, storedIcon("provider", 3));

    const replaced = yield* SubscriptionRef.get(icons.current);

    expect(replaced?.source).toBe("provider");
    expect(yield* storedBytes(replaced?.id ?? "")).toStrictEqual(Uint8Array.of(3));
  }).pipe(Effect.provide(TestIconStore)),
);
