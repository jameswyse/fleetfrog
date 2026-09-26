import { describe, expect, it } from "@effect/vitest";

import { parseGitVersion, parseOsRelease } from "./systemInfo.ts";

describe("system info parsing", () => {
  it("reads the distribution's pretty name, quoted or not", () => {
    expect(parseOsRelease('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 26.04 LTS"\nID=ubuntu\n')).toBe(
      "Ubuntu 26.04 LTS",
    );
    expect(parseOsRelease("PRETTY_NAME=Arch Linux\n")).toBe("Arch Linux");
    expect(parseOsRelease("NAME=Alpine\n")).toBeNull();
  });

  it("reads Git's version number, including platform suffixes", () => {
    expect(parseGitVersion("git version 2.53.0\n")).toBe("2.53.0");
    expect(parseGitVersion("git version 2.50.1 (Apple Git-155)\n")).toBe("2.50.1");
    expect(parseGitVersion("command not found")).toBeNull();
  });
});
