import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { remoteIdentity } from "./remoteIdentity.ts";

describe("remoteIdentity", () => {
  it.each([
    "git@github.com:Acme/Shop.git",
    "github.com:acme/shop",
    "https://github.com/acme/shop",
    "https://user:secret@GitHub.com/acme/shop.git/",
    "ssh://git@github.com:22/acme/shop.git",
  ])("treats %s as github.com/acme/shop", (url) => {
    expect(remoteIdentity(url)).toEqual(
      Option.some({ _tag: "Remote", host: "github.com", path: "acme/shop" }),
    );
  });

  it("keeps nested group paths", () => {
    expect(remoteIdentity("git@gitlab.com:group/sub/project.git")).toEqual(
      Option.some({ _tag: "Remote", host: "gitlab.com", path: "group/sub/project" }),
    );
  });

  it.each(["/srv/git/shop.git", "../shop", "file:///srv/git/shop.git"])(
    "has no remote identity for the local path %s",
    (url) => {
      expect(remoteIdentity(url)).toEqual(Option.none());
    },
  );
});
