import { describe, expect, it } from "@effect/vitest";

import { archiveDestination, checkArchiveFolder, unarchiveDestination } from "./archiveFolder.ts";

const home = "/Users/james";

describe("checkArchiveFolder", () => {
  it("allows a visible folder inside or outside the project folders", () => {
    expect(
      checkArchiveFolder({ folder: "~/Projects/Archive", home, roots: ["~/Projects"] }),
    ).toEqual({ _tag: "Valid", path: "/Users/james/Projects/Archive" });
    expect(checkArchiveFolder({ folder: "~/Archive", home, roots: ["~/Projects"] })._tag).toBe(
      "Valid",
    );
  });

  it("refuses hidden folders and folders holding a project folder", () => {
    expect(checkArchiveFolder({ folder: "~/.archive", home, roots: [] })._tag).toBe("Hidden");
    expect(checkArchiveFolder({ folder: "~/Projects", home, roots: ["~/Projects"] })).toEqual({
      _tag: "ContainsProjectFolder",
      root: "~/Projects",
    });
    expect(checkArchiveFolder({ folder: "~", home, roots: ["~/Projects"] })._tag).toBe(
      "ContainsProjectFolder",
    );
  });
});

describe("archive destinations", () => {
  const roots = ["~/Projects", "~/Code"];
  const archive = "/Users/james/Archive";

  it("keeps a checkout's path below its project folder", () => {
    expect(archiveDestination({ path: "/Users/james/Code/acme/shop", archive, home, roots })).toBe(
      "/Users/james/Archive/acme/shop",
    );
    expect(archiveDestination({ path: "/srv/shop", archive, home, roots })).toBe(
      "/Users/james/Archive/shop",
    );
  });

  it("returns a checkout to where it came from while that's still a project folder", () => {
    const path = "/Users/james/Archive/acme/shop";

    expect(
      unarchiveDestination({
        path,
        originalPath: "/Users/james/Code/acme/shop",
        archive,
        home,
        roots,
      }),
    ).toBe("/Users/james/Code/acme/shop");
    expect(
      unarchiveDestination({ path, originalPath: "/Volumes/Old/shop", archive, home, roots }),
    ).toBe("/Users/james/Projects/acme/shop");
    expect(unarchiveDestination({ path, originalPath: null, archive, home, roots: [] })).toBeNull();
  });
});
