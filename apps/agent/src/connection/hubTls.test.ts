import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect, createServer } from "node:tls";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { fetchPinnedCertificate, pinnedTlsOptions } from "./hubTls.ts";

import type { Server } from "node:tls";

function createCertificate() {
  const directory = mkdtempSync(path.join(tmpdir(), "fleetfrog-tls-"));
  const keyPath = path.join(directory, "key.pem");
  const certificatePath = path.join(directory, "certificate.pem");

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=FleetFrog test hub",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
    ],
    { stdio: "ignore" },
  );

  return {
    certificatePem: readFileSync(certificatePath, "utf8"),
    privateKeyPem: readFileSync(keyPath, "utf8"),
  };
}

const hub = createCertificate();
const impostor = createCertificate();

/** A TLS server presenting the hub certificate, closed when the test's scope ends. */
const hubServer = Effect.acquireRelease(
  Effect.callback<Server>((resume) => {
    const server = createServer({ cert: hub.certificatePem, key: hub.privateKeyPem }, (socket) =>
      socket.end(),
    );

    server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
  }),
  (server) => Effect.sync(() => server.close()),
).pipe(
  Effect.flatMap((server) => {
    const address = server.address();

    // A TCP server reports an address object; a string would mean a pipe or socket path.
    return address instanceof Object
      ? Effect.succeed(address.port)
      : Effect.die(new Error("The test server is not listening on a TCP port."));
  }),
);

/** Connects with the agent's pinned options, succeeding only if the handshake is accepted. */
function handshake(options: { readonly port: number; readonly pinned: string }) {
  return Effect.callback<"accepted" | "rejected">((resume) => {
    const socket = connect({
      host: "127.0.0.1",
      port: options.port,
      ...pinnedTlsOptions(options.pinned),
    });

    socket.once("secureConnect", () => {
      socket.destroy();
      resume(Effect.succeed("accepted"));
    });
    socket.once("error", () => resume(Effect.succeed("rejected")));
  });
}

describe("hub certificate pinning", () => {
  it.effect("accepts the pinned certificate and rejects any other before sending data", () =>
    Effect.gen(function* () {
      const port = yield* hubServer;

      expect(yield* handshake({ port, pinned: hub.certificatePem })).toBe("accepted");
      expect(yield* handshake({ port, pinned: impostor.certificatePem })).toBe("rejected");
    }).pipe(Effect.scoped),
  );

  it.effect("fetches the hub certificate only when it matches the pairing fingerprint", () =>
    Effect.gen(function* () {
      const port = yield* hubServer;
      const url = new URL(`wss://127.0.0.1:${port}`);
      const fingerprint = new X509Certificate(hub.certificatePem).fingerprint256;
      const pinned = yield* fetchPinnedCertificate({ url, fingerprint });
      const mismatch = yield* fetchPinnedCertificate({
        url,
        fingerprint: new X509Certificate(impostor.certificatePem).fingerprint256,
      }).pipe(Effect.flip);

      expect(new X509Certificate(pinned).fingerprint256).toBe(fingerprint);
      expect(mismatch._tag).toBe("CertificateMismatch");
    }).pipe(Effect.scoped),
  );
});
