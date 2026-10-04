import { Option, Schema } from "effect";

/** Everything an agent needs to pair with a hub, packed into one pasteable string. */
export const PairingInvite = Schema.Struct({
  /** The agent endpoint, e.g. `wss://192.168.1.10:7421`. */
  agentUrl: Schema.String,
  code: Schema.String,
  /**
   * SHA-256 fingerprint of the hub's self-signed certificate, in Node's `AA:BB:…` form.
   * Absent when the hub sits behind a proxy with a certificate from a public authority.
   */
  certificateFingerprint: Schema.NullOr(Schema.String),
});
export type PairingInvite = typeof PairingInvite.Type;

export const pairingCodeLifetimeMinutes = 10;

const prefix = "ffp1_";

const PairingPayload = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(PairingInvite)),
);

const decodePayload = Schema.decodeUnknownOption(PairingPayload);
const encodePayload = Schema.encodeSync(PairingPayload);

export function encodePairingString(invite: PairingInvite): string {
  return `${prefix}${encodePayload(invite)}`;
}

export function decodePairingString(value: string): Option.Option<PairingInvite> {
  const trimmed = value.trim();

  return trimmed.startsWith(prefix) ? decodePayload(trimmed.slice(prefix.length)) : Option.none();
}
