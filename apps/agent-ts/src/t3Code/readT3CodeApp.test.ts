import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { readT3CodeProviders, readT3CodeServer, versionOf } from "./readT3CodeApp.ts";

describe("versionOf", () => {
  it.effect("reads the version from a service's folder or from the app's Info.plist", () =>
    Effect.gen(function* () {
      const home = yield* temporaryDirectory("fleetfrog-t3app-");
      const app = path.join(home, "T3 Code (Nightly).app");

      mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
      writeFileSync(
        path.join(app, "Contents", "Info.plist"),
        `<plist><dict><key>CFBundleName</key><string>T3 Code</string>
        <key>CFBundleShortVersionString</key>
        <string>0.0.43-nightly.20260927.2331</string></dict></plist>`,
      );

      expect(
        yield* Effect.promise(() =>
          Promise.all([
            versionOf("/home/dev/.t3/runtime/versions/0.0.41-nightly.20260916.1795/t3"),
            versionOf(path.join(app, "Contents", "MacOS", "T3 Code (Nightly)")),
            versionOf("/usr/local/bin/t3"),
          ]),
        ),
      ).toEqual(["0.0.41-nightly.20260916.1795", "0.0.43-nightly.20260927.2331", null]);
    }),
  );
});

describe("readT3CodeServer", () => {
  it.effect("counts a runtime file whose process is gone, or isn't T3 Code, as not running", () =>
    Effect.gen(function* () {
      const userdata = yield* temporaryDirectory("fleetfrog-t3app-");

      const runtime = (pid: number) =>
        writeFileSync(
          path.join(userdata, "server-runtime.json"),
          JSON.stringify({ version: 1, pid, port: 3773, startedAt: "2026-09-27T04:24:30.413Z" }),
        );

      expect(yield* readT3CodeServer(userdata)).toBeNull();

      // This test's own process is running, but it's Node rather than T3 Code.
      runtime(process.pid);
      expect(yield* readT3CodeServer(userdata)).toBeNull();

      runtime(2 ** 22 + 1);
      expect(yield* readT3CodeServer(userdata)).toBeNull();
    }),
  );
});

describe("readT3CodeProviders", () => {
  it.effect("lists the coding agents turned on, with any newer version T3 Code knows of", () =>
    Effect.gen(function* () {
      const caches = yield* temporaryDirectory("fleetfrog-t3app-");

      const provider = (file: string, contents: unknown) =>
        writeFileSync(path.join(caches, file), JSON.stringify(contents));

      provider("codex.json", {
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        version: "0.157.1",
        versionAdvisory: { status: "outdated", latestVersion: "0.158.0" },
        auth: { status: "authenticated", email: "dev@example.com" },
      });
      provider("claudeAgent.json", {
        displayName: "Claude",
        enabled: true,
        installed: true,
        status: "error",
        version: "2.1.283",
        versionAdvisory: { status: "current", latestVersion: "2.1.283" },
        auth: { status: "unauthenticated" },
      });
      provider("grok.json", {
        displayName: "Grok",
        enabled: false,
        status: "disabled",
        version: null,
      });
      writeFileSync(path.join(caches, "broken.json"), "{");

      expect(yield* readT3CodeProviders(caches)).toEqual([
        { name: "Claude", version: "2.1.283", latestVersion: null, ready: false, signedIn: false },
        {
          name: "Codex",
          version: "0.157.1",
          latestVersion: "0.158.0",
          ready: true,
          signedIn: true,
        },
      ]);
    }),
  );
});
