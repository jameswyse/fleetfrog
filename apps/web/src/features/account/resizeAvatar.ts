import { avatarMediaTypes } from "@fleetfrog/protocol/domain/user";

import type { AvatarMediaType } from "@fleetfrog/protocol/domain/user";

const side = 256;

function isAvatarMediaType(type: string): type is AvatarMediaType {
  return avatarMediaTypes.some((known) => known === type);
}

export async function resizeAvatar(
  file: File,
): Promise<{ readonly mediaType: AvatarMediaType; readonly data: Uint8Array } | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);

  if (bitmap === null) {
    return null;
  }

  const crop = Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(side, side);
  const context = canvas.getContext("2d");

  if (context === null) {
    return null;
  }

  context.drawImage(
    bitmap,
    (bitmap.width - crop) / 2,
    (bitmap.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    side,
    side,
  );
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });

  return isAvatarMediaType(blob.type)
    ? { mediaType: blob.type, data: new Uint8Array(await blob.arrayBuffer()) }
    : null;
}
