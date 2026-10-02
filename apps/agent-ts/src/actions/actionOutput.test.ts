import { describe, expect, it } from "@effect/vitest";

import { makeActionOutput } from "./actionOutput.ts";

describe("makeActionOutput", () => {
  it("cuts a line at the limit and keeps the next whole", () => {
    const output = makeActionOutput();

    output.write("a".repeat(70 * 1024));
    output.write("more\nnext\n");

    const tail = output.tail();

    expect(tail.length).toBe(2);
    expect(tail[0]?.length).toBe(64 * 1024);
    expect(tail[1]).toBe("next");
  });

  it("removes credentials from the lines sent to the hub", () => {
    const output = makeActionOutput();

    output.write("Fetching https://a:b@host/one\nhttps://c:d@host/two");

    expect(output.progress()).toBe("https://host/two");
    expect(output.tail()).toEqual(["Fetching https://host/one", "https://host/two"]);
  });
});
