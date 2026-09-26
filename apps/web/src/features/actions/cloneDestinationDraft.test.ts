import { describe, expect, it } from "vitest";

import { draftFromSuggestion, draftPath } from "./cloneDestinationDraft.ts";

const machine = {
  info: { homeDirectory: "/home/me" },
  discoveryRoots: [{ path: "~/Projects/" }, { path: "/srv/code" }],
};

describe("draftFromSuggestion", () => {
  it("splits a suggestion at its project folder when one is written with ~ and one in full", () => {
    expect(
      draftFromSuggestion({
        machine,
        suggestion: { destination: "/home/me/Projects/legacy/app", root: { path: "~/Projects/" } },
        repositoryName: "app",
      }),
    ).toEqual({ root: "~/Projects/", name: "legacy/app" });
    expect(
      draftFromSuggestion({
        machine,
        suggestion: { destination: "~/code/app", root: { path: "/home/me/code" } },
        repositoryName: "app",
      }),
    ).toEqual({ root: "/home/me/code", name: "app" });
  });

  it("starts in the first project folder, named after the repository, without a suggestion", () => {
    expect(draftFromSuggestion({ machine, suggestion: null, repositoryName: "app" })).toEqual({
      root: "~/Projects/",
      name: "app",
    });
  });
});

describe("draftPath", () => {
  it("joins the folder and name with one slash, ignoring stray slashes and spaces", () => {
    expect(draftPath({ root: "~/Projects/", name: " /legacy/app " })).toBe("~/Projects/legacy/app");
    expect(draftPath({ root: "/srv/code", name: "app" })).toBe("/srv/code/app");
  });
});
