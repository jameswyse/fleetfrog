import { createHash, randomBytes } from "node:crypto";

/** Agent tokens are stored only as SHA-256 hashes. Their 256 random bits make a slow hash unnecessary. */
export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueAgentToken() {
  const token = `fft_${randomBytes(32).toString("base64url")}`;

  return { token, tokenHash: hashAgentToken(token) };
}
