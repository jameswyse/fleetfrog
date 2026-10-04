import { createHash } from "node:crypto";

import { Context, Effect, Layer, Option, Schema, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { ProviderIconSource } from "@fleetfrog/protocol/domain/user";

import type { ProviderIcon } from "@fleetfrog/protocol/domain/user";

export const maximumIconBytes = 256 * 1024;

const iconTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
] as const;

const IconType = Schema.Literals(iconTypes);
type IconType = typeof IconType.Type;

const startsWith = (data: Uint8Array, bytes: ReadonlyArray<number>, at = 0) =>
  bytes.every((byte, i) => data[at + i] === byte);

export function iconType(data: Uint8Array): IconType | null {
  if (data.byteLength === 0 || data.byteLength > maximumIconBytes) {
    return null;
  }

  const text = new TextDecoder().decode(data.subarray(0, 512)).trimStart().toLowerCase();

  const found: ReadonlyArray<[boolean, IconType]> = [
    [startsWith(data, [0x89, 0x50, 0x4e, 0x47]), "image/png"],
    [startsWith(data, [0xff, 0xd8, 0xff]), "image/jpeg"],
    [
      startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8),
      "image/webp",
    ],
    [startsWith(data, [0x47, 0x49, 0x46, 0x38]), "image/gif"],
    [startsWith(data, [0x00, 0x00, 0x01, 0x00]), "image/x-icon"],
    [
      text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg")),
      "image/svg+xml",
    ],
  ];

  return found.find(([matches]) => matches)?.[1] ?? null;
}

const linkTag = /<link\b[^>]*>/giu;

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu").exec(tag);

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function iconLinks(html: string, page: URL): ReadonlyArray<URL> {
  const links = [...html.matchAll(linkTag)].flatMap(([tag]) => {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/u) ?? [];
    const href = attribute(tag, "href");

    return href !== undefined &&
      rel.some((word) => word.includes("icon")) &&
      URL.canParse(href, page)
      ? [{ url: new URL(href, page), home: rel.includes("apple-touch-icon") }]
      : [];
  });

  return [...links.filter(({ home }) => home), ...links.filter(({ home }) => !home)].map(
    ({ url }) => url,
  );
}

const maximumPageBytes = 1024 * 1024;
const maximumCandidates = 5;

async function download(url: URL, limit: number): Promise<{ url: URL; data: Uint8Array } | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

  if (!response.ok || response.body === null) {
    return null;
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Array<Uint8Array> = [];
  let size = 0;

  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;

    if (size > limit) {
      await reader.cancel();

      return null;
    }

    chunks.push(read.value);
  }

  return { url: new URL(response.url), data: new Uint8Array(Buffer.concat(chunks)) };
}

export const fetchProviderIcon = (issuerUrl: string) =>
  Effect.promise(async () => {
    const site = new URL("/", issuerUrl);
    const page = await download(site, maximumPageBytes).catch(() => null);

    const candidates = [
      ...(page === null
        ? []
        : iconLinks(new TextDecoder().decode(page.data), page.url).slice(0, maximumCandidates - 1)),
      new URL("/favicon.ico", site),
    ];

    for (const candidate of candidates) {
      const data = (await download(candidate, maximumIconBytes).catch(() => null))?.data ?? null;
      const mediaType = data === null ? null : iconType(data);

      if (data !== null && mediaType !== null) {
        return Option.some({ data, mediaType });
      }
    }

    return Option.none();
  });

const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ hash: Schema.String, source: ProviderIconSource })),
);

const decodeData = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ media_type: IconType, data: Schema.Uint8Array })),
);

export class ProviderIconStore extends Context.Service<
  ProviderIconStore,
  {
    readonly current: SubscriptionRef.SubscriptionRef<ProviderIcon | null>;
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<{ readonly mediaType: IconType; readonly data: Uint8Array }>>;
    readonly replace: (
      icon: {
        readonly data: Uint8Array;
        readonly mediaType: IconType;
        readonly source: ProviderIconSource;
      } | null,
    ) => Effect.Effect<void>;
  }
>()("fleetfrog/ProviderIconStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const [stored] = yield* sql`select hash, source from provider_icon where id = 1`.pipe(
        Effect.flatMap(decodeRows),
        Effect.orDie,
      );

      const current = yield* SubscriptionRef.make<ProviderIcon | null>(
        stored === undefined ? null : { id: stored.hash, source: stored.source },
      );

      return {
        current,
        find: (id) =>
          sql`select media_type, data from provider_icon where hash = ${id}`.pipe(
            Effect.flatMap(decodeData),
            Effect.map(([row]) =>
              Option.fromUndefinedOr(row).pipe(
                Option.map(({ media_type, data }) => ({ mediaType: media_type, data })),
              ),
            ),
            Effect.orDie,
          ),
        replace: (icon) =>
          Effect.gen(function* () {
            yield* sql`delete from provider_icon`;

            if (icon === null) {
              return yield* SubscriptionRef.set(current, null);
            }

            const hash = createHash("sha256").update(icon.data).digest("hex");

            yield* sql`insert into provider_icon ${sql.insert({
              id: 1,
              hash,
              media_type: icon.mediaType,
              source: icon.source,
              data: icon.data,
            })}`;

            return yield* SubscriptionRef.set(current, { id: hash, source: icon.source });
          }).pipe(Effect.orDie),
      };
    }),
  );
}
