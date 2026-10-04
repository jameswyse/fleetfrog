import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { createProjectFolder } from "./createProjectFolder.ts";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";

const setUp = (options: {
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder?: string;
  readonly policy?: AgentPolicy;
}) =>
  Effect.gen(function* () {
    const home = yield* temporaryDirectory("fleetfrog-folders-");
    const audit: Array<AuditEntry> = [];

    const create = (folder: string) =>
      createProjectFolder({
        path: folder,
        roots: options.roots,
        archiveFolder: options.archiveFolder ?? null,
        home,
        loadPolicy: Effect.succeed(options.policy ?? { allowedTiers: ["git"] }),
        audit: (entry) => Effect.sync(() => audit.push(entry)),
      });

    return { home, audit, create };
  });

describe("createProjectFolder", () => {
  it.effect("creates a missing project folder with its parents, and records it", () =>
    Effect.gen(function* () {
      const { home, audit, create } = yield* setUp({ roots: ["~/Other Projects/client"] });

      expect(yield* create("~/Other Projects/client")).toEqual({ _tag: "Created" });
      expect(statSync(path.join(home, "Other Projects", "client")).isDirectory()).toBe(true);
      expect(audit).toEqual([
        { event: "FolderCreated", path: path.join(home, "Other Projects", "client") },
      ]);
    }),
  );

  it.effect("leaves a folder that is already there alone", () =>
    Effect.gen(function* () {
      const { home, audit, create } = yield* setUp({ roots: ["~/Code"] });

      mkdirSync(path.join(home, "Code"));

      expect(yield* create("~/Code")).toEqual({ _tag: "AlreadyThere" });
      expect(audit).toEqual([]);
    }),
  );

  it.effect("creates nothing that isn't a project folder, is hidden or is refused", () =>
    Effect.gen(function* () {
      const configured = yield* setUp({ roots: ["~/Code", "~/.config/autostart"] });

      expect((yield* configured.create("~/Elsewhere"))._tag).toBe("Failed");
      expect((yield* configured.create("~/.config/autostart"))._tag).toBe("Failed");
      expect(existsSync(path.join(configured.home, "Elsewhere"))).toBe(false);
      expect(existsSync(path.join(configured.home, ".config"))).toBe(false);

      const denied = yield* setUp({ roots: ["~/Code"], policy: { allowedTiers: [] } });

      expect((yield* denied.create("~/Code"))._tag).toBe("Failed");
      expect(existsSync(path.join(denied.home, "Code"))).toBe(false);
    }),
  );

  it.effect("says so when a file is in the folder's place", () =>
    Effect.gen(function* () {
      const { home, create } = yield* setUp({ roots: ["~/Code"] });

      writeFileSync(path.join(home, "Code"), "not a folder");

      expect(yield* create("~/Code")).toMatchObject({ _tag: "Failed" });
    }),
  );

  it.effect("creates the Archive folder only when cleanup actions are allowed", () =>
    Effect.gen(function* () {
      const allowed = yield* setUp({
        roots: ["~/Projects"],
        archiveFolder: "~/Projects/Archive",
        policy: { allowedTiers: ["git", "cleanup"] },
      });

      expect(yield* allowed.create("~/Projects/Archive")).toMatchObject({ _tag: "Created" });
      expect(statSync(path.join(allowed.home, "Projects", "Archive")).isDirectory()).toBe(true);

      const denied = yield* setUp({ roots: ["~/Projects"], archiveFolder: "~/Projects/Archive" });

      expect(yield* denied.create("~/Projects/Archive")).toMatchObject({ _tag: "Failed" });
      expect(existsSync(path.join(denied.home, "Projects", "Archive"))).toBe(false);
    }),
  );
});
