import { Option, Schema } from "effect";

export const PairingInvite = Schema.Struct({
  agentUrl: Schema.String,
  code: Schema.String,
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
