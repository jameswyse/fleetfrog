import { createHash, randomBytes } from "node:crypto";

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueAgentToken() {
  const token = `fft_${randomBytes(32).toString("base64url")}`;

  return { token, tokenHash: hashAgentToken(token) };
}
