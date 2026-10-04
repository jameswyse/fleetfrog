import { maximumAvatarBytes } from "@fleetfrog/protocol/domain/user";

import type { UploadedAvatar } from "./userStore.ts";

const signatures = {
  "image/png": (data) =>
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => data[i] === byte),
  "image/jpeg": (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/webp": (data) =>
    new TextDecoder().decode(data.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(data.subarray(8, 12)) === "WEBP",
} satisfies Record<UploadedAvatar["mediaType"], (data: Uint8Array) => boolean>;

export function isAvatarImage({ mediaType, data }: UploadedAvatar): boolean {
  return data.byteLength <= maximumAvatarBytes && signatures[mediaType](data);
}
