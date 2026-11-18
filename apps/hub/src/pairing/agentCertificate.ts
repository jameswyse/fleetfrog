import { X509Certificate } from "node:crypto";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { Context, DateTime, Effect, FileSystem, Layer } from "effect";

import { HubConfig } from "../hubConfig.ts";
import { createSelfSignedCertificate } from "./selfSignedCertificate.ts";

const validityYears = 20;

export class AgentCertificate extends Context.Service<
  AgentCertificate,
  {
    readonly tls: {
      readonly certificatePem: string;
      readonly privateKeyPem: string;
      readonly fingerprint: string;
    } | null;
  }
>()("fleetfrog/AgentCertificate") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const config = yield* HubConfig;

      if (config.agentTls === "none" || config.demo) {
        return { tls: null };
      }

      const fs = yield* FileSystem.FileSystem;
      const directory = path.join(config.dataDirectory, "agent-tls");
      const certificatePath = path.join(directory, "certificate.pem");
      const privateKeyPath = path.join(directory, "private-key.pem");

      const generate = Effect.gen(function* () {
        const now = yield* DateTime.now;

        const generated = createSelfSignedCertificate({
          commonName: "FleetFrog hub",
          notBefore: DateTime.toDate(DateTime.subtract(now, { days: 1 })),
          notAfter: DateTime.toDate(DateTime.add(now, { years: validityYears })),
        });

        yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
        yield* fs
          .writeFileString(privateKeyPath, generated.privateKeyPem, { mode: 0o600 })
          .pipe(
            Effect.andThen(fs.writeFileString(certificatePath, generated.certificatePem)),
            Effect.uninterruptible,
          );

        return generated;
      });

      const { certificatePem, privateKeyPem } = yield* Effect.all({
        certificatePem: fs.readFileString(certificatePath),
        privateKeyPem: fs.readFileString(privateKeyPath),
      }).pipe(Effect.catchReason("PlatformError", "NotFound", () => generate));

      return {
        tls: {
          certificatePem,
          privateKeyPem,
          fingerprint: new X509Certificate(certificatePem).fingerprint256,
        },
      };
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer));
}
