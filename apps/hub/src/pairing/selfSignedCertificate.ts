import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

/*
 * Node can sign and parse certificates but not build them, so this encodes the handful of DER
 * structures an X.509 v1 self-signed certificate needs (RFC 5280 §4.1). Node exports the public key
 * as a complete SubjectPublicKeyInfo and produces the ECDSA signature.
 */

const ecdsaWithSha256 = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
const commonNameOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const bytes: Array<number> = [];

  for (let remaining = length; remaining > 0; remaining = Math.floor(remaining / 256)) {
    bytes.unshift(remaining % 256);
  }

  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, ...contents: ReadonlyArray<Buffer>): Buffer {
  const content = Buffer.concat(contents);

  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const sequence = (...contents: ReadonlyArray<Buffer>) => der(0x30, ...contents);

/** RFC 5280 requires UTCTime through 2049 and GeneralizedTime from 2050. */
function derTime(date: Date): Buffer {
  const iso = date.toISOString();
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;

  return date.getUTCFullYear() < 2050
    ? der(0x17, Buffer.from(digits.slice(2), "ascii"))
    : der(0x18, Buffer.from(digits, "ascii"));
}

function toPem(label: string, body: Buffer): string {
  const lines = body.toString("base64").match(/.{1,64}/g) ?? [];

  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function createSelfSignedCertificate(options: {
  readonly commonName: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const serial = randomBytes(16);

  // A positive serial whose first byte keeps the DER integer minimal.
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40;

  const name = sequence(
    der(0x31, sequence(commonNameOid, der(0x0c, Buffer.from(options.commonName, "utf8")))),
  );

  const algorithm = sequence(ecdsaWithSha256);

  const toBeSigned = sequence(
    der(0x02, serial),
    algorithm,
    name,
    sequence(derTime(options.notBefore), derTime(options.notAfter)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  );

  const signature = sign("sha256", toBeSigned, { key: privateKey, dsaEncoding: "der" });
  const certificate = sequence(toBeSigned, algorithm, der(0x03, Buffer.from([0x00]), signature));

  return {
    certificatePem: toPem("CERTIFICATE", certificate),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
