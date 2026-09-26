import { describe, expect, it } from "@effect/vitest";

import {
  parseGitVersion,
  parseHypervisor,
  parseOsRelease,
  parseProductName,
  parseVmStat,
} from "./systemInfo.ts";

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

  it("splits the Mac's model name from its detail, as About This Mac shows them", () => {
    expect(
      parseProductName('  | |   "product-name" = <"MacBook Pro (13-inch, M1, 2020)">\n'),
    ).toEqual({ name: "MacBook Pro", detail: "13-inch, M1, 2020" });
    expect(parseProductName('"product-name" = <"Mac mini (2024)">')).toEqual({
      name: "Mac mini",
      detail: "2024",
    });
    expect(parseProductName('"product-name" = <"Virtual Mac">')).toEqual({
      name: "Virtual Mac",
      detail: null,
    });
    expect(parseProductName("")).toBeNull();
  });

  it("names the hypervisor, or none on a physical machine", () => {
    expect(parseHypervisor("kvm\n")).toBe("KVM");
    expect(parseHypervisor("microsoft\n")).toBe("Hyper-V");
    expect(parseHypervisor("acrn\n")).toBe("acrn");
    expect(parseHypervisor("none\n")).toBeNull();
  });

  it("counts app, wired and compressed memory from vm_stat, leaving out caches", () => {
    const output = [
      "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
      "Pages free:                                     7022.",
      "Pages active:                                 379324.",
      "Pages inactive:                               381784.",
      "Pages wired down:                             153098.",
      "Pages purgeable:                               13391.",
      '"Translation faults":                     2229674483.',
      "File-backed pages:                            363324.",
      "Anonymous pages:                              398384.",
      "Pages occupied by compressor:                  93297.",
    ].join("\n");

    // (398384 - 13391 + 153098 + 93297) pages of 16 KiB.
    expect(parseVmStat(output)).toBe(631_388 * 16_384);
    expect(parseVmStat("Pages free: 12.")).toBeNull();
  });
});
