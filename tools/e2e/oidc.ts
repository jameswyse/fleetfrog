import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

import { Predicate, Schema } from "effect";

export async function startIdentityProvider() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: "jwk" }), kid: "e2e", use: "sig", alg: "RS256" };
  const codes = new Map<string, { nonce: string; challenge: string; redirect: string }>();
  let issuer = "";

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", issuer);
      response.setHeader("Content-Type", "application/json");

      if (url.pathname === "/.well-known/openid-configuration") {
        response.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            token_endpoint_auth_methods_supported: ["client_secret_post"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
      } else if (url.pathname === "/jwks") {
        response.end(JSON.stringify({ keys: [key] }));
      } else if (url.pathname === "/authorize") {
        const redirect = url.searchParams.get("redirect_uri");
        const nonce = url.searchParams.get("nonce");
        const challenge = url.searchParams.get("code_challenge");
        const state = url.searchParams.get("state");

        if (
          redirect === null ||
          nonce === null ||
          challenge === null ||
          state === null ||
          url.searchParams.get("client_id") !== "fleetfrog-e2e" ||
          url.searchParams.get("response_type") !== "code" ||
          url.searchParams.get("code_challenge_method") !== "S256"
        ) {
          response.writeHead(400).end(JSON.stringify({ error: "invalid_request" }));

          return;
        }

        const callback = new URL(redirect);

        if (callback.hostname !== "127.0.0.1" || callback.pathname !== "/auth/oidc/callback") {
          response.writeHead(400).end(JSON.stringify({ error: "invalid_redirect" }));

          return;
        }

        const code = randomUUID();
        codes.set(code, { nonce, challenge, redirect });
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", state);
        response.writeHead(302, { Location: callback.href }).end();
      } else if (url.pathname === "/token" && request.method === "POST") {
        request.setEncoding("utf8");
        const chunks: string[] = [];

        for await (const chunk of request) {
          chunks.push(Schema.decodeUnknownSync(Schema.String)(chunk));
        }

        const form = new URLSearchParams(chunks.join(""));

        if (
          form.get("client_id") !== "fleetfrog-e2e" ||
          form.get("client_secret") !== "E2E provider client secret"
        ) {
          response.writeHead(401).end(JSON.stringify({ error: "invalid_client" }));

          return;
        }

        const code = form.get("code") ?? "";
        const pending = codes.get(code);
        codes.delete(code);

        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");

        if (
          pending === undefined ||
          form.get("grant_type") !== "authorization_code" ||
          pending.challenge !== challenge ||
          pending.redirect !== form.get("redirect_uri")
        ) {
          response.writeHead(400).end(JSON.stringify({ error: "invalid_grant" }));

          return;
        }

        const now = Math.floor(Date.now() / 1000);

        const header = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "e2e", typ: "JWT" }),
        ).toString("base64url");

        const payload = Buffer.from(
          JSON.stringify({
            iss: issuer,
            aud: "fleetfrog-e2e",
            sub: "e2e-provider-user",
            nonce: pending.nonce,
            iat: now,
            exp: now + 300,
            email: "provider@e2e.example.test",
            email_verified: true,
            name: "E2E provider user",
            groups: ["fleetfrog-users"],
          }),
        ).toString("base64url");

        const token = `${header}.${payload}`;
        const signature = sign("RSA-SHA256", Buffer.from(token), privateKey).toString("base64url");
        response.end(
          JSON.stringify({
            access_token: "e2e-local-access",
            token_type: "Bearer",
            expires_in: 300,
            id_token: `${token}.${signature}`,
          }),
        );
      } else {
        response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
      }
    } catch {
      response.writeHead(500).end(JSON.stringify({ error: "provider_error" }));
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("The local identity provider has no port.");
  }

  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      ),
  };
}
