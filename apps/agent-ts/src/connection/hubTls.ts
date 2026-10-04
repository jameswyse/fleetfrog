import { X509Certificate } from "node:crypto";
import { connect } from "node:tls";

import { Effect, Schema } from "effect";

import type { PeerCertificate } from "node:tls";

export class HubUnreachable extends Schema.TaggedError<HubUnreachable>()("HubUnreachable", {
  message: Schema.String,
}) {}

export class CertificateMismatch extends Schema.TaggedError<CertificateMismatch>()(
  "CertificateMismatch",
  { expected: Schema.String, received: Schema.String },
) {}

function toPem(certificate: PeerCertificate): string {
  const lines = certificate.raw.toString("base64").match(/.{1,64}/g) ?? [];

  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

export function fetchPinnedCertificate(options: {
  readonly url: URL;
  readonly fingerprint: string;
}) {
  return Effect.callback<string, HubUnreachable | CertificateMismatch>((resume) => {
    const socket = connect({
      host: options.url.hostname.replace(/^\[(.*)\]$/, "$1"),
      port: Number(options.url.port || 443),
      rejectUnauthorized: false,
      timeout: 15_000,
    });

    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();

      socket.end();
      resume(
        certificate.fingerprint256 === options.fingerprint
          ? Effect.succeed(toPem(certificate))
          : Effect.fail(
              new CertificateMismatch({
                expected: options.fingerprint,
                received: certificate.fingerprint256,
              }),
            ),
      );
    });
    socket.once("timeout", () => {
      socket.destroy();
      resume(Effect.fail(new HubUnreachable({ message: "Timed out connecting to the hub" })));
    });
    socket.once("error", (error) =>
      resume(Effect.fail(new HubUnreachable({ message: error.message }))),
    );

    return Effect.sync(() => socket.destroy());
  });
}

export function pinnedTlsOptions(certificatePem: string | null) {
  if (certificatePem === null) {
    return {};
  }

  const { fingerprint256 } = new X509Certificate(certificatePem);

  return {
    ca: certificatePem,
    checkServerIdentity: (_host: string, certificate: PeerCertificate) =>
      certificate.fingerprint256 === fingerprint256
        ? undefined
        : new Error("The hub's certificate does not match the one pinned at pairing"),
  };
}
