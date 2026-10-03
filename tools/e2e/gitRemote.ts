import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import path from "node:path";

import { Predicate } from "effect";

import { gitEnvironment } from "./repositories.ts";

/** Serve the fixture's bare remote using Git's HTTPS protocol and a sandbox certificate. */
export async function startGitRemote(directory: string) {
  const certificate = path.join(directory, "git-remote.crt");
  const key = path.join(directory, "git-remote.key");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "pipe" },
  );
  const children = new Set<ReturnType<typeof spawn>>();
  const server = createServer(
    { key: readFileSync(key), cert: readFileSync(certificate) },
    (request, response) => {
      const url = new URL(request.url ?? "/", "https://127.0.0.1");

      if (!url.pathname.startsWith("/clone-project.git/")) {
        response.writeHead(404).end();

        return;
      }

      const child = spawn("git", ["http-backend"], {
        env: {
          ...gitEnvironment,
          GIT_PROJECT_ROOT: directory,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: request.method ?? "GET",
          CONTENT_TYPE: request.headers["content-type"] ?? "",
          REMOTE_ADDR: "127.0.0.1",
        },
        stdio: ["pipe", "pipe", "ignore"],
      });
      children.add(child);
      const output: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      child.once("error", () => response.writeHead(500).end());
      request.pipe(child.stdin);
      child.stdin.on("error", () => response.destroy());
      child.once("close", (code) => {
        children.delete(child);

        if (response.destroyed) {
          return;
        }

        const result = Buffer.concat(output);
        const boundary = result.indexOf("\r\n\r\n");

        if (code !== 0 || boundary < 0) {
          response.writeHead(500).end();

          return;
        }

        for (const line of result.subarray(0, boundary).toString().split("\r\n")) {
          const colon = line.indexOf(":");
          const name = line.slice(0, colon);
          const value = line.slice(colon + 1).trim();

          if (name === "Status") {
            response.statusCode = Number(value.split(" ")[0]);
          } else {
            response.setHeader(name, value);
          }
        }

        response.end(result.subarray(boundary + 4));
      });
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("The local Git remote has no port.");
  }

  const url = `https://127.0.0.1:${address.port}/clone-project.git`;
  writeFileSync(
    path.join(directory, "gitconfig"),
    `[url "${url}"]\n\tinsteadOf = https://e2e.example.test/clone-project.git\n`,
  );

  return {
    certificate,
    close: () => {
      for (const child of children) {
        child.kill("SIGTERM");
      }

      server.closeAllConnections();

      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    },
  };
}
