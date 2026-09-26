import { VitestProgressReporter } from "./progressReporter.ts";

type VitestReporter = "github-actions" | "minimal" | "verbose" | VitestProgressReporter;

interface VitestReporterOptions {
  githubActions: string | undefined;
  humanOutput: string | undefined;
}

interface VitestReporterConfiguration {
  reporters: VitestReporter[];
  silent: false | "passed-only";
}

export function vitestReporterConfiguration({
  githubActions,
  humanOutput,
}: VitestReporterOptions): VitestReporterConfiguration {
  if (humanOutput === "1") {
    return { reporters: ["verbose"], silent: false };
  }

  if (githubActions) {
    return {
      reporters: ["minimal", "github-actions"],
      silent: "passed-only",
    };
  }

  return {
    reporters: [new VitestProgressReporter(), "minimal"],
    silent: "passed-only",
  };
}
