import { mirrorChildResult, runWorkspaceBinary } from "./childProcess.mjs";

const humanOutput = process.env.FLEETFROG_HUMAN_OUTPUT === "1";
const outputArguments = humanOutput
  ? ["--output-logs=full", "--log-order=stream", "--log-prefix=none"]
  : ["--log-order=stream", "--log-prefix=task"];
const cliArguments = process.argv.slice(2);
const passthroughIndex = cliArguments.indexOf("--");
const turboArguments =
  passthroughIndex === -1
    ? [...cliArguments, ...outputArguments]
    : [
        ...cliArguments.slice(0, passthroughIndex),
        ...outputArguments,
        ...cliArguments.slice(passthroughIndex),
      ];
mirrorChildResult(await runWorkspaceBinary("turbo", turboArguments));
