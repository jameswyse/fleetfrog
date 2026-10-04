import { useState } from "react";

import { Avatar as AvatarSource } from "@fleetfrog/protocol/domain/user";

const whitespace = /\s+/u;
const graphemes = new Intl.Segmenter();

function initials(name: string): string {
  const words = name.trim().split(whitespace);
  const letters = words.length === 1 ? [words[0]] : [words[0], words.at(-1)];

  return letters
    .map((word) => graphemes.segment(word ?? "").containing(0)?.segment ?? "")
    .join("")
    .toUpperCase();
}

function pictureUrl(avatar: AvatarSource, size: number): string | null {
  return AvatarSource.match(avatar, {
    Uploaded: ({ id }) => `/avatars/${id}`,
    Provider: ({ url }) => url,
    Gravatar: ({ hash }) => `https://gravatar.com/avatar/${hash}?s=${size * 2}&d=404`,
    None: () => null,
  });
}

export function Avatar({
  user,
  size,
  className = "",
}: {
  readonly user: { readonly displayName: string; readonly avatar: AvatarSource };
  readonly size: number;
  readonly className?: string;
}) {
  const url = pictureUrl(user.avatar, size);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft font-medium text-accent-text select-none ${className}`}
    >
      {initials(user.displayName)}
      {url !== null && failed !== url && (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          className="absolute inset-0 size-full rounded-full object-cover outline -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
        />
      )}
    </span>
  );
}
