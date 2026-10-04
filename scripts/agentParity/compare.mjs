// Checks that the Rust agent reads checkouts exactly as the TypeScript agent does: the same
// discovery results, statuses and inspections, fingerprints included, for repositories in the
// awkward states `fixtures.sh` creates. Run it through `pnpm --filter @fleetfrog/agent-rs test:unit`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const repository = path.resolve(import.meta.dirname, "../..");
const fixtureScript = path.join(import.meta.dirname, "fixtures.sh");
const rustAgent = path.join(repository, "apps/agent-rs/target/debug/fleetfrog");
const typeScriptReadings = path.join(repository, "apps/agent-ts/src/parity/readings.ts");
// Git run by either agent ignores the developer's own configuration.
const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

// The fixtures are deterministic and only read, so each version of the script builds them once.
const fixtureHash = createHash("sha256").update(readFileSync(fixtureScript)).digest("hex");

const projects = path.join(
  tmpdir(),
  `fleetfrog-agent-parity-${fixtureHash.slice(0, 12)}`,
  "projects",
);

if (!existsSync(projects)) {
  execFileSync("bash", [fixtureScript, projects], { stdio: "inherit" });
}

function read(command, arguments_) {
  return JSON.parse(execFileSync(command, arguments_, { encoding: "utf8", env: environment }));
}

function readBoth(arguments_) {
  return {
    typeScript: read(process.execPath, [typeScriptReadings, ...arguments_]),
    rust: read(rustAgent, [`__${arguments_[0]}`, ...arguments_.slice(1)]),
  };
}

let failures = 0;

function compare(label, { typeScript, rust }) {
  if (isDeepStrictEqual(typeScript, rust)) {
    console.log(`same: ${label}`);

    return;
  }

  failures += 1;
  console.log(`DIFFERENT: ${label}`);
  console.log(`  TypeScript: ${JSON.stringify(typeScript)}`);
  console.log(`  Rust:       ${JSON.stringify(rust)}`);
}

const scans = readBoth([
  "scan",
  "--archive",
  path.join(path.dirname(projects), "Archive"),
  projects,
]);

const byPath = (checkouts) =>
  checkouts.toSorted((left, right) => left.path.localeCompare(right.path));

compare("discovery and status", { typeScript: byPath(scans.typeScript), rust: byPath(scans.rust) });

for (const checkout of scans.typeScript) {
  compare(`inspection of ${checkout.path}`, readBoth(["inspect", checkout.path]));

  for (const worktree of checkout.status.git?.worktrees ?? []) {
    compare(`inspection of ${worktree.path}`, readBoth(["inspect", checkout.path, worktree.path]));
  }
}

// T3 Code's database has no fixture, so this compares readings of this machine's own, in each layout
// it has.
const t3CodeUserdata = path.join(
  process.env.T3CODE_HOME ?? path.join(homedir(), ".t3"),
  "userdata",
);

// The TypeScript agent lists icons in the order its reads finish, and the hub keeps them as a set.
function withSortedIcons({ typeScript, rust }) {
  const sorted = (reading) => ({
    ...reading,
    icons: reading.icons.toSorted((left, right) => left.id.localeCompare(right.id)),
  });

  return { typeScript: sorted(typeScript), rust: sorted(rust) };
}

for (const file of ["state.sqlite", "statev2.sqlite"]) {
  const database = path.join(t3CodeUserdata, file);

  compare(`T3 Code at ${database}`, withSortedIcons(readBoth(["t3code", database])));
}

compare(
  "T3 Code without a database",
  withSortedIcons(readBoth(["t3code", path.join(projects, "state.sqlite")])),
);

// GitHub needs a signed-in `gh`, so this compares readings of this repository's own checkout.
function githubLogin() {
  try {
    return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const login = githubLogin();

if (login === null) {
  console.log("skipped: GitHub, since gh isn't signed in");
} else {
  const { typeScript, rust } = readBoth(["github", login, repository]);
  const unchecked = (state) => (state === null ? null : { ...state, checkedAt: null });

  compare(`GitHub for ${repository}`, { typeScript: unchecked(typeScript), rust: unchecked(rust) });
}

if (failures > 0) {
  console.log(`${failures} readings differ between the agents. The fixtures are in ${projects}.`);
  process.exitCode = 1;
}
