import { describe, expect, it } from "vitest";

import { maskPersonal } from "./personalText.ts";

describe("maskPersonal", () => {
  it.each([
    ["/home/sam/Projects/shop", "/home/•••/Projects/shop"],
    ["/var/home/sam/shop", "/var/home/•••/shop"],
    ["/Users/sam", "/Users/•••"],
    [String.raw`C:\Users\sam\Projects`, String.raw`C:\Users\•••\Projects`],
    ["git@github.com:sam/shop.git", "git@github.com:•••/shop.git"],
    ["ssh://git@gitea.example.com/sam/shop.git", "ssh://git@gitea.example.com/•••/shop.git"],
    ["https://sam@bitbucket.org/acme/shop.git", "https://•••@bitbucket.org/•••/shop.git"],
    ["Moved /home/sam/a to /home/sam/b.", "Moved /home/•••/a to /home/•••/b."],
  ])("hides the account name in %s", (text, masked) => {
    expect(maskPersonal(text)).toBe(masked);
  });

  it.each(["/srv/repos/shop", "~/Projects/shop", "apps/web/src/main.tsx", "main"])(
    "leaves %s alone",
    (text) => {
      expect(maskPersonal(text)).toBe(text);
    },
  );
});
