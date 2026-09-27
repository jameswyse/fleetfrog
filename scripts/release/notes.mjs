// Prints the release notes for a version, such as `node scripts/release/notes.mjs 0.1.0`. Every
// package shares one version and a change that names several packages appears in each of their
// changelogs, so the notes merge those sections and list each change once.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const version = process.argv[2];

if (version === undefined) {
  console.error("Usage: node scripts/release/notes.mjs <version>");
  process.exit(1);
}

const repository = path.resolve(import.meta.dirname, "../..");
const changelogs = ["apps", "packages"]
  .flatMap((folder) =>
    readdirSync(path.join(repository, folder)).map((name) =>
      path.join(repository, folder, name, "CHANGELOG.md"),
    ),
  )
  .filter((changelog) => existsSync(changelog));
const kinds = ["Major Changes", "Minor Changes", "Patch Changes"];
// Each change, with the most significant kind any package gave it.
const changes = new Map();

for (const changelog of changelogs) {
  const lines = readFileSync(changelog, "utf8").split("\n");
  const start = lines.indexOf(`## ${version}`);

  if (start === -1) {
    continue;
  }

  let kind = -1;
  let change;

  const record = () => {
    if (change === undefined) {
      return;
    }

    const text = change.trimEnd();
    const recorded = changes.get(text);

    changes.set(text, recorded === undefined ? kind : Math.min(recorded, kind));
    change = undefined;
  };

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    if (line.startsWith("### ")) {
      record();
      kind = kinds.indexOf(line.slice(4));
    } else if (line.startsWith("- ")) {
      record();
      change = line;
    } else if (change !== undefined) {
      // A change's later paragraphs and lists are indented beneath it.
      change = `${change}\n${line}`;
    }
  }

  record();
}

const sections = kinds.flatMap((heading, index) => {
  const entries = [...changes].filter(([, kind]) => kind === index).map(([text]) => text);

  return entries.length === 0
    ? []
    : [`### ${heading.replace(" Changes", " changes")}\n\n${entries.join("\n")}`];
});

console.log(
  [
    "Update the hub before the agents: an older hub can't read every report from a newer agent.",
    ...sections,
  ].join("\n\n"),
);
