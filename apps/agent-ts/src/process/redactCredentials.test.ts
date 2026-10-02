import { describe, expect, it } from "@effect/vitest";

import { redactCredentials } from "./redactCredentials.ts";

describe("redactCredentials", () => {
  it("removes the user name and password from a URL", () => {
    expect(
      redactCredentials("fatal: unable to access 'https://user:token@github.com/x/y.git/'"),
    ).toBe("fatal: unable to access 'https://github.com/x/y.git/'");
  });

  it("leaves a URL without credentials alone", () => {
    expect(redactCredentials("Cloning https://github.com/x/y.git")).toBe(
      "Cloning https://github.com/x/y.git",
    );
  });

  it("leaves an @ outside a URL alone", () => {
    expect(redactCredentials("git@github.com:x/y.git")).toBe("git@github.com:x/y.git");
  });
});
