import { createPrivateKey, X509Certificate } from "node:crypto";

import { describe, expect, it } from "@effect/vitest";

import { createSelfSignedCertificate } from "./selfSignedCertificate.ts";

describe("createSelfSignedCertificate", () => {
  it("produces a certificate Node parses, that verifies with its own key and matches the private key", () => {
    const { certificatePem, privateKeyPem } = createSelfSignedCertificate({
      commonName: "FleetFrog hub",
      notBefore: new Date("2026-01-01T00:00:00Z"),
      notAfter: new Date("2060-01-01T00:00:00Z"),
    });
    const certificate = new X509Certificate(certificatePem);

    expect(certificate.subject).toBe("CN=FleetFrog hub");
    expect(certificate.validToDate.toISOString()).toBe("2060-01-01T00:00:00.000Z");
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(certificate.checkPrivateKey(createPrivateKey(privateKeyPem))).toBe(true);
  });
});
