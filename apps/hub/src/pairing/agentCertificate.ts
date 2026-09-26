import { X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Context, DateTime, Effect, Layer } from "effect";

import { HubConfig } from "../hubConfig.ts";
import { createSelfSignedCertificate } from "./selfSignedCertificate.ts";

const validityYears = 20;

/** The self-signed certificate agents pin during pairing. Absent when agent TLS is off. */
export class AgentCertificate extends Context.Service<
  AgentCertificate,
  {
    readonly tls: {
      readonly certificatePem: string;
      readonly privateKeyPem: string;
      /** Node's `AA:BB:…` SHA-256 fingerprint, as agents see it on the TLS peer certificate. */
      readonly fingerprint: string;
    } | null;
  }
>()("fleetfrog/AgentCertificate") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const config = yield* HubConfig;

      if (config.agentTls === "none") {
        return { tls: null };
      }

      const directory = path.join(config.dataDirectory, "agent-tls");
      const certificatePath = path.join(directory, "certificate.pem");
      const privateKeyPath = path.join(directory, "private-key.pem");
      const now = yield* DateTime.now;
      // Backdated so an agent whose clock runs a little behind still accepts it.
      const notBefore = DateTime.toDate(DateTime.subtract(now, { days: 1 }));
      const notAfter = DateTime.toDate(DateTime.add(now, { years: validityYears }));

      const { certificatePem, privateKeyPem } = yield* Effect.tryPromise(async () => {
        try {
          return {
            certificatePem: await readFile(certificatePath, "utf8"),
            privateKeyPem: await readFile(privateKeyPath, "utf8"),
          };
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
          }
        }

        const generated = createSelfSignedCertificate({
          commonName: "FleetFrog hub",
          notBefore,
          notAfter,
        });

        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(privateKeyPath, generated.privateKeyPem, { mode: 0o600 });
        await writeFile(certificatePath, generated.certificatePem);

        return generated;
      }).pipe(Effect.orDie);

      return {
        tls: {
          certificatePem,
          privateKeyPem,
          fingerprint: new X509Certificate(certificatePem).fingerprint256,
        },
      };
    }),
  );
}
