import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { supportedT3CodeSchema } from "../../packages/protocol/src/domain/t3Code.ts";

/** Git without the developer's config or `GIT_*` variables. */
export const gitEnvironment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

const projectNames = [
  "clean-project",
  "dirty-project",
  "dirty-switch-project",
  "archive-project",
  "agent-switch-project",
  "agent-archive-project",
  "stash-project",
  "branches-project",
  "trash-project",
  "purge-project",
  "remove-worktree-project",
  "failure-project",
  "fetch-project",
  "clone-project",
  "bulk-project",
  "cancel-project",
  "delete-project",
  "empty-trash-a-project",
  "empty-trash-b-project",
  "archive-trash-project",
  "t3-project",
  "filter-project",
] as const;

export const initialRepositoryCount = projectNames.length + 1;

export function git(directory: string, ...arguments_: string[]): string {
  return execFileSync("git", ["-C", directory, ...arguments_], {
    env: gitEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function fixturePaths(directory: string) {
  const projects = path.join(directory, "projects");
  const archive = path.join(directory, "archive");

  return {
    projects,
    archive,
    secondProjects: path.join(directory, "second-projects"),
    stash: path.join(projects, "stash-project"),
    branches: path.join(projects, "branches-project"),
    trash: path.join(projects, "trash-project"),
    purge: path.join(projects, "purge-project"),
    removeWorktree: path.join(projects, "remove-worktree-project"),
    removableWorktree: path.join(projects, "removable-worktree"),
    failure: path.join(projects, "failure-project"),
    fetch: path.join(projects, "fetch-project"),
    clone: path.join(projects, "clone-project"),
    bulk: path.join(projects, "bulk-project"),
    cancel: path.join(projects, "cancel-project"),
    delete: path.join(projects, "delete-project"),
    emptyTrashA: path.join(projects, "empty-trash-a-project"),
    emptyTrashB: path.join(projects, "empty-trash-b-project"),
    archiveTrash: path.join(projects, "archive-trash-project"),
    t3: path.join(projects, "t3-project"),
    clean: path.join(projects, "clean-project"),
    dirty: path.join(projects, "dirty-project"),
    dirtySwitch: path.join(projects, "dirty-switch-project"),
    pull: path.join(projects, "pull-project"),
    filter: path.join(projects, "filter-project"),
    archiveProject: path.join(projects, "archive-project"),
    worktree: path.join(projects, "archive-worktree"),
    agentSwitch: path.join(projects, "agent-switch-project"),
    agentArchive: path.join(projects, "agent-archive-project"),
  };
}

/** Every run gets local repositories and a local remote. No GitHub credentials or network. */
export function createRepositories(directory: string): void {
  const fixtures = fixturePaths(directory);

  mkdirSync(fixtures.projects);
  mkdirSync(fixtures.archive);
  mkdirSync(fixtures.secondProjects);

  for (const name of projectNames) {
    const checkout = path.join(fixtures.projects, name);

    mkdirSync(checkout);
    git(checkout, "init", "--initial-branch=main");
    git(checkout, "config", "user.name", "FleetFrog E2E");
    git(checkout, "config", "user.email", "e2e@example.test");
    writeFileSync(path.join(checkout, "README.md"), `${name}\n`);
    writeFileSync(path.join(checkout, ".gitignore"), "ignored.txt\n");
    git(checkout, "add", ".");
    git(checkout, "commit", "-m", "Initial fixture");
    git(checkout, "branch", "feature/e2e");
  }

  writeFileSync(path.join(fixtures.dirty, "README.md"), "Uncommitted fixture changes\n");
  writeFileSync(path.join(fixtures.dirtySwitch, "README.md"), "Uncommitted fixture changes\n");
  writeFileSync(path.join(fixtures.stash, "README.md"), "Tracked stash changes\n");
  writeFileSync(path.join(fixtures.stash, "notes.txt"), "Untracked stash changes\n");
  writeFileSync(path.join(fixtures.trash, "notes.txt"), "Restore these notes\n");
  writeFileSync(path.join(fixtures.trash, "ignored.txt"), "Restore ignored content\n");
  git(fixtures.removeWorktree, "worktree", "add", fixtures.removableWorktree, "feature/e2e");
  writeFileSync(
    path.join(fixtures.removableWorktree, "README.md"),
    "Keep removed worktree changes\n",
  );
  writeFileSync(
    path.join(fixtures.removableWorktree, "ignored.txt"),
    "Disposable ignored content\n",
  );
  git(fixtures.branches, "switch", "-c", "local-only");
  writeFileSync(path.join(fixtures.branches, "local.txt"), "Keep this branch commit\n");
  git(fixtures.branches, "add", ".");
  git(fixtures.branches, "commit", "-m", "Local branch work");
  git(fixtures.branches, "switch", "main");
  git(fixtures.branches, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(fixtures.branches, "update-ref", "refs/remotes/origin/main", "main");
  writeFileSync(path.join(fixtures.archiveProject, "notes.txt"), "Keep these untracked notes\n");
  writeFileSync(path.join(fixtures.archiveProject, "ignored.txt"), "Keep this ignored file\n");
  git(fixtures.archiveProject, "worktree", "add", fixtures.worktree, "feature/e2e");
  writeFileSync(path.join(fixtures.worktree, "worktree-notes.txt"), "Keep worktree notes\n");

  const remote = path.join(directory, "remote.git");

  git(directory, "init", "--bare", "--initial-branch=main", remote);
  git(directory, "clone", remote, fixtures.pull);
  git(fixtures.pull, "config", "user.name", "FleetFrog E2E");
  git(fixtures.pull, "config", "user.email", "e2e@example.test");
  writeFileSync(path.join(fixtures.pull, "README.md"), "Before pull\n");
  git(fixtures.pull, "add", ".");
  git(fixtures.pull, "commit", "-m", "Initial fixture");
  git(fixtures.pull, "push", "--set-upstream", "origin", "main");

  const author = path.join(directory, "remote-author");

  git(directory, "clone", remote, author);
  git(author, "config", "user.name", "FleetFrog E2E");
  git(author, "config", "user.email", "e2e@example.test");
  writeFileSync(path.join(author, "README.md"), "Pulled from the local remote\n");
  git(author, "add", ".");
  git(author, "commit", "-m", "Remote update");
  git(author, "push", "origin", "main");
  git(fixtures.pull, "fetch", "origin");

  for (const checkout of [
    fixtures.fetch,
    fixtures.clone,
    fixtures.bulk,
    fixtures.cancel,
    fixtures.filter,
  ]) {
    const localRemote = path.join(directory, `${path.basename(checkout)}.git`);

    git(directory, "clone", "--bare", checkout, localRemote);
    git(checkout, "remote", "add", "origin", localRemote);
    git(checkout, "fetch", "origin");
    git(checkout, "branch", "--set-upstream-to=origin/main", "main");
    git(checkout, "remote", "set-head", "origin", "main");
  }

  // The harness rewrites this origin to its loopback HTTPS Git server.
  git(fixtures.clone, "remote", "set-url", "origin", "https://e2e.example.test/clone-project.git");
  const fetchAuthor = path.join(directory, "fetch-author");

  git(directory, "clone", path.join(directory, "fetch-project.git"), fetchAuthor);
  git(fetchAuthor, "config", "user.name", "FleetFrog E2E");
  git(fetchAuthor, "config", "user.email", "e2e@example.test");
  writeFileSync(path.join(fetchAuthor, "fetched.txt"), "Remote fetch update\n");
  git(fetchAuthor, "add", ".");
  git(fetchAuthor, "commit", "-m", "Fetch update");
  git(fetchAuthor, "push", "origin", "main");
  const filterAuthor = path.join(directory, "filter-author");
  git(directory, "clone", path.join(directory, "filter-project.git"), filterAuthor);
  git(filterAuthor, "config", "user.name", "FleetFrog E2E");
  git(filterAuthor, "config", "user.email", "e2e@example.test");
  writeFileSync(path.join(filterAuthor, "filter.txt"), "Filter stays behind its remote\n");
  git(filterAuthor, "add", ".");
  git(filterAuthor, "commit", "-m", "Filter remote update");
  git(filterAuthor, "push", "origin", "main");
  git(fixtures.filter, "fetch", "origin");
  const userdata = path.join(directory, "t3code/userdata");
  mkdirSync(userdata, { recursive: true });
  mkdirSync(path.join(directory, "t3-no-repository"));
  const database = new DatabaseSync(path.join(userdata, "statev2.sqlite"));

  try {
    database.exec(`
      CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, created_at TEXT, name TEXT);
      CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, title TEXT, workspace_root TEXT,
        project_icon_json TEXT, favicon_path TEXT, auto_pull INTEGER, updated_at TEXT, deleted_at TEXT);
      CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT,
        title TEXT, payload_json TEXT, archived_at TEXT, deleted_at TEXT, updated_at TEXT);
      CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, status TEXT);
      CREATE TABLE orchestration_v2_projection_runtime_requests (runtime_request_id TEXT PRIMARY KEY,
        thread_id TEXT, kind TEXT, status TEXT);
    `);
    const now = new Date().toISOString();
    database
      .prepare("INSERT INTO effect_sql_migrations VALUES (?, ?, ?)")
      .run(supportedT3CodeSchema.migration, now, supportedT3CodeSchema.name);
    const project = database.prepare(
      "INSERT INTO projection_projects VALUES (?, ?, ?, ?, NULL, 0, ?, NULL)",
    );
    project.run(
      "e2e-project",
      "E2E T3 project",
      fixtures.t3,
      JSON.stringify({ kind: "lucide", name: "sparkles", color: "amber" }),
      now,
    );
    project.run(
      "e2e-no-repository",
      "E2E non-Git project",
      path.join(directory, "t3-no-repository"),
      null,
      now,
    );
    database
      .prepare("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?, NULL, NULL, ?)")
      .run(
        "e2e-thread",
        "e2e-project",
        "E2E coding thread",
        JSON.stringify({ worktreePath: null }),
        now,
      );
    database
      .prepare("INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, ?)")
      .run("e2e-run", "e2e-thread", "running");
  } finally {
    database.close();
  }

  writeFileSync(path.join(directory, ".fleetfrog-e2e"), "FleetFrog local test environment\n");
}

export function sandboxDirectory(): string {
  const directory = process.env.FLEETFROG_E2E_DIR;

  if (
    directory === undefined ||
    path.dirname(directory) !== "/tmp" ||
    !path.basename(directory).startsWith("fleetfrog-e2e-") ||
    readFileSync(path.join(directory, ".fleetfrog-e2e"), "utf8") !==
      "FleetFrog local test environment\n"
  ) {
    throw new Error("Run the e2e suite through pnpm test:e2e to create an isolated environment.");
  }

  return directory;
}
