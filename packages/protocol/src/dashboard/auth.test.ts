import { describe, expect, it } from "@effect/vitest";

import { localPath } from "./auth.ts";

describe("localPath", () => {
  it("keeps a path on this site", () => {
    expect(localPath("/settings/users?tab=1#top")).toBe("/settings/users?tab=1#top");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/.//evil.example",
    "/..//evil.example",
    "/a/..//evil.example",
    "/%2e%2e//evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
  ])("sends %j home instead of off-site", (redirect) => {
    expect(localPath(redirect)).toBe("/");
  });

  it("sends a missing redirect home", () => {
    expect(localPath(undefined)).toBe("/");
    expect(localPath(null)).toBe("/");
  });
});
