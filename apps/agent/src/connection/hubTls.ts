import { X509Certificate } from "node:crypto";
import { connect } from "node:tls";

import { Data, Effect } from "effect";

import type { PeerCertificate } from "node:tls";

export class HubUnreachable extends Data.TaggedError("HubUnreachable")<{
  readonly message: string;
}> {}

export class CertificateMismatch extends Data.TaggedError("CertificateMismatch")<{
  readonly expected: string;
  readonly received: string;
}> {}

function toPem(certificate: PeerCertificate): string {
  const lines = certificate.raw.toString("base64").match(/.{1,64}/g) ?? [];

  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

/**
 * Fetches the hub's certificate without trusting it, then accepts it only if it matches the
 * fingerprint from the pairing string. Nothing is sent to the hub before that check.
 */
export function fetchPinnedCertificate(options: {
  readonly url: URL;
  readonly fingerprint: string;
}) {
  return Effect.callback<string, HubUnreachable | CertificateMismatch>((resume) => {
    const socket = connect({
      host: options.url.hostname,
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

/**
 * TLS options that trust only the pinned hub certificate. Hostname checks are replaced by the
 * fingerprint check because the certificate is tied to the hub, not to an address.
 */
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
