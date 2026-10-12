import { describe, expect, it } from "@effect/vitest";

import { newestT3CodeReleases } from "./t3CodeReleaseFeed.ts";

describe("newestT3CodeReleases", () => {
  it("takes the first published release on each channel from GitHub's newest-first list", () => {
    expect(
      newestT3CodeReleases([
        { tag_name: "v0.0.47-nightly.20261013.3050", draft: true },
        { tag_name: "v0.0.46-nightly.20261012.3021", draft: false },
        { tag_name: "desktop-v0.0.46", draft: false },
        { tag_name: "v0.0.46-nightly.20261011.2980", draft: false },
        { tag_name: "v0.0.45", draft: false },
        { tag_name: "v0.0.44", draft: false },
      ]),
    ).toEqual({ stable: "0.0.45", nightly: "0.0.46-nightly.20261012.3021", preview: null });
  });
});
