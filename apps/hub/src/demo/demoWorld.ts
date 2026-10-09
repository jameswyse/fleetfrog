import { createHash } from "node:crypto";

import { DateTime } from "effect";

import { CheckoutStatus, Head, Placement, Worktree } from "@fleetfrog/protocol/domain/checkout";
import { GithubCli } from "@fleetfrog/protocol/domain/machine";
import { repositoryKey, RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";
import {
  ProjectIcon,
  supportedT3CodeSchema,
  T3CodeReading,
} from "@fleetfrog/protocol/domain/t3Code";
import { TrashId } from "@fleetfrog/protocol/domain/trash";

import { demoGithubLogin } from "./demoFleetData.ts";
import { demoIcons } from "./demoIcons.ts";

import type { ProjectIconFile } from "@fleetfrog/protocol/agent/rpcs";
import type {
  ChangedFile,
  Checkout,
  DeletedBranch,
  DroppedStash,
  FileState,
  GitStatus,
  LocalBranch,
  MergedPullRequest,
  Operation,
  PullRequest,
  Upstream,
} from "@fleetfrog/protocol/domain/checkout";
import type { MachineInfo, SystemUsage } from "@fleetfrog/protocol/domain/machine";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";
import type { T3CodeStatus, T3CodeThreadState } from "@fleetfrog/protocol/domain/t3Code";
import type { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

import type {
  DemoBranch,
  DemoCheckout,
  DemoMachine,
  DemoProjectIcon,
  DemoRemote,
  DemoRepository,
} from "./demoFleetData.ts";
import type { DemoIconName } from "./demoIcons.ts";

export interface SimCommit {
  readonly sha: string;
  readonly subject: string;
  readonly committedAt: DateTime.Utc;
}

export interface SimRemote {
  readonly spec: DemoRepository;
  readonly identity: RepositoryIdentity;
  readonly key: RepositoryKey;
  readonly originUrl: string | null;
  readonly onGithub: boolean;
  readonly history: Array<SimCommit>;
  readonly initialLength: number;
  readonly pullRequests: ReadonlyArray<PullRequest>;
  readonly mergedPullRequests: ReadonlyArray<MergedPullRequest>;
}

export interface SimBranch {
  readonly name: string;
  readonly commits: ReadonlyArray<SimCommit>;
  ahead: number;
  behind: number;
  upstream: "Tracking" | "None" | "Gone";
  readonly merged: boolean;
}

export interface SimThread {
  readonly id: string;
  readonly title: string;
  state: T3CodeThreadState;
  updatedAt: DateTime.Utc;
}

export interface SimTree {
  path: string;
  head: string;
  changed: Array<ChangedFile>;
  untracked: Array<string>;
  operation: Operation | null;
  readonly threads: Array<SimThread>;
}

export interface SimStash {
  readonly message: string;
  readonly sha: string;
}

export interface SimRepository {
  readonly remote: SimRemote;
  local: number;
  fetched: number;
  readonly unpushed: Array<SimCommit>;
  readonly branches: Array<SimBranch>;
  readonly stashes: Array<SimStash>;
  readonly deletedBranches: Array<{ readonly record: DeletedBranch; readonly branch: SimBranch }>;
  readonly droppedStashes: Array<{ readonly record: DroppedStash; readonly stash: SimStash }>;
  lastFetchedAt: DateTime.Utc | null;
  placement: Placement;
  readonly main: SimTree;
  readonly linked: Array<SimTree>;
  readonly sizeBytes: number;
}

export function treesOf(repository: SimRepository): ReadonlyArray<SimTree> {
  return [repository.main, ...repository.linked];
}

export interface SimTrashEntry {
  readonly item: TrashedCheckout;
  readonly repository: SimRepository;
}

export interface SimMachine {
  readonly spec: DemoMachine;
  readonly repositories: Array<SimRepository>;
  readonly trash: Array<SimTrashEntry>;
  archiveFolder: string | null;
}

export interface DemoWorld {
  readonly remotes: ReadonlyMap<RepositoryKey, SimRemote>;
  readonly machines: ReadonlyArray<SimMachine>;
}

const mebibyte = 1024 * 1024;
const gibibyte = 1024 * mebibyte;

export function digest(...parts: ReadonlyArray<string>): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex");
}

export function uuidFrom(...parts: ReadonlyArray<string>): string {
  const hex = digest(...parts);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function minutesBefore(now: DateTime.Utc, minutes: number): DateTime.Utc {
  return DateTime.subtract(now, { minutes });
}

function originUrlOf(identity: RepositoryIdentity): string | null {
  return identity._tag === "Remote" ? `https://${identity.host}/${identity.path}.git` : null;
}

function identityOf(remote: DemoRemote): RepositoryIdentity {
  return remote._tag === "Remote"
    ? RepositoryIdentity.cases.Remote.make({ host: remote.host, path: remote.path })
    : RepositoryIdentity.cases.RootCommit.make({ sha: remote.rootCommit });
}

function createRemote(spec: DemoRepository, now: DateTime.Utc): SimRemote {
  const identity = identityOf(spec.remote);

  const reach = Math.max(
    0,
    ...Object.values(spec.checkouts).map(
      (checkout) => (checkout.behind ?? 0) + (checkout.unfetched ?? 0),
    ),
  );

  const length = spec.history.length + reach;

  const history = Array.from({ length }, (_, position): SimCommit => {
    const age = length - 1 - position;

    return {
      sha: digest(spec.key, "history", String(position)),
      subject: spec.history[age % spec.history.length] ?? spec.key,
      committedAt: minutesBefore(now, spec.latestMinutesAgo + age * spec.minutesBetweenCommits),
    };
  });

  const url = (number: number) =>
    identity._tag === "Remote" ? `https://${identity.host}/${identity.path}/pull/${number}` : "";

  const pulls = spec.pullRequests ?? [];

  return {
    spec,
    identity,
    key: repositoryKey(identity),
    originUrl: originUrlOf(identity),
    onGithub: identity._tag === "Remote" && identity.host === "github.com",
    history,
    initialLength: history.length,
    pullRequests: pulls
      .filter(({ merged }) => merged !== true)
      .map((pull) => ({
        number: pull.number,
        title: pull.title,
        url: url(pull.number),
        branch: pull.branch,
        draft: pull.draft ?? false,
      })),
    mergedPullRequests: pulls
      .filter(({ merged }) => merged === true)
      .map((pull) => ({
        number: pull.number,
        url: url(pull.number),
        branch: pull.branch,
        sha: digest(spec.key, "branch", pull.branch, "0"),
      })),
  };
}

function createBranch(remote: SimRemote, spec: DemoBranch, now: DateTime.Utc): SimBranch {
  const upstream = spec.upstream ?? "Tracking";

  return {
    name: spec.name,
    commits: spec.commits.map((subject, index) => ({
      sha: digest(remote.spec.key, "branch", spec.name, String(index)),
      subject,
      committedAt: minutesBefore(now, spec.minutesAgo + index * 45),
    })),
    ahead: upstream === "Tracking" ? (spec.unpushed ?? 0) : 0,
    behind: upstream === "Tracking" ? (spec.behind ?? 0) : 0,
    upstream,
    merged: spec.merged ?? false,
  };
}

function fileState(code: string | undefined): FileState {
  const states: ReadonlyArray<FileState> = [".", "M", "T", "A", "D", "R", "C", "U"];

  return states.find((state) => state === code) ?? ".";
}

function parseChanges(changes: ReadonlyArray<string>) {
  const changed: Array<ChangedFile> = [];
  const untracked: Array<string> = [];

  for (const change of changes) {
    const code = change.slice(0, 2);
    const path = change.slice(3);

    if (code === "??") {
      untracked.push(path);
    } else {
      changed.push({
        path,
        originalPath: null,
        staged: fileState(code[0]),
        unstaged: fileState(code[1]),
      });
    }
  }

  return { changed, untracked };
}

function createThreads(
  key: string,
  path: string,
  threads: DemoCheckout["threads"],
  now: DateTime.Utc,
): Array<SimThread> {
  return (threads ?? []).map((thread) => ({
    id: uuidFrom(key, path, thread.title),
    title: thread.title,
    state: thread.state,
    updatedAt: minutesBefore(now, thread.minutesAgo),
  }));
}

function sizeOf(folder: string): number {
  return (40 + (Number.parseInt(digest(folder).slice(0, 4), 16) % 900)) * mebibyte;
}

function createRepository(
  machine: DemoMachine,
  remote: SimRemote,
  spec: DemoCheckout,
  now: DateTime.Utc,
): SimRepository {
  const repository = remote.spec;
  const unfetched = spec.unfetched ?? 0;
  const fetched = remote.history.length - unfetched;
  const projectsPath = `${machine.roots[repository.root]}/${repository.folder}`;

  const placement =
    spec.archivedDaysAgo === undefined || machine.archive === null
      ? Placement.cases.Projects.make({})
      : Placement.cases.Archive.make({
          originalPath: projectsPath,
          archivedAt: DateTime.subtract(now, { days: spec.archivedDaysAgo }),
        });

  const mainPath =
    placement._tag === "Archive" ? `${machine.archive}/${repository.folder}` : projectsPath;

  const branches = [
    ...(spec.branch === undefined ? [] : [spec.branch]),
    ...(spec.branches ?? []),
    ...(spec.worktrees ?? []).map(({ branch }) => branch),
  ].map((branch) => createBranch(remote, branch, now));

  const key = `${machine.key}:${repository.key}`;

  const main: SimTree = {
    path: mainPath,
    head: spec.branch?.name ?? repository.defaultBranch,
    ...parseChanges(spec.changes ?? []),
    operation: spec.operation ?? null,
    threads: createThreads(key, mainPath, spec.threads, now),
  };

  const linked = (spec.worktrees ?? []).map((worktree): SimTree => {
    const path = `${machine.roots[repository.root]}/${worktree.folder}`;

    return {
      path,
      head: worktree.branch.name,
      ...parseChanges(worktree.changes ?? []),
      operation: null,
      threads: createThreads(key, path, worktree.threads, now),
    };
  });

  const deletedBranches = (spec.deletedBranches ?? []).map(({ name, daysAgo }) => {
    const branch = createBranch(
      remote,
      { name, commits: [`Experiment with ${name.split("/").at(-1) ?? name}`], minutesAgo: 0 },
      DateTime.subtract(now, { days: daysAgo + 3 }),
    );

    const deletedAt = DateTime.subtract(now, { days: daysAgo });
    const tip = branch.commits[0];

    return {
      record: {
        name,
        ref: `refs/fleetfrog/deleted/${DateTime.toEpochMillis(deletedAt)}/${name}`,
        sha: tip?.sha ?? "",
        subject: tip?.subject ?? "",
        deletedAt,
      },
      branch,
    };
  });

  const droppedStashes = (spec.droppedStashes ?? []).map(({ message, daysAgo }) => {
    const droppedAt = DateTime.subtract(now, { days: daysAgo });
    const stash = { message, sha: digest(key, "dropped", message) };

    return {
      record: {
        ref: `refs/fleetfrog/stashes/${DateTime.toEpochMillis(droppedAt)}/0`,
        sha: stash.sha,
        message,
        droppedAt,
      },
      stash,
    };
  });

  return {
    remote,
    local: fetched - (spec.behind ?? 0),
    fetched,
    unpushed: (spec.unpushed ?? []).map((subject, index) => ({
      sha: digest(key, "unpushed", String(index)),
      subject,
      committedAt: minutesBefore(now, 25 + index * 40),
    })),
    branches,
    stashes: (spec.stashes ?? []).map((message) => ({ message, sha: digest(key, message) })),
    deletedBranches,
    droppedStashes,
    lastFetchedAt:
      remote.originUrl === null || spec.fetchedMinutesAgo === undefined
        ? null
        : minutesBefore(now, spec.fetchedMinutesAgo),
    placement,
    main,
    linked,
    sizeBytes: sizeOf(repository.folder),
  };
}

export function emptyRepository(options: {
  readonly remote: SimRemote;
  readonly path: string;
  readonly now: DateTime.Utc;
}): SimRepository {
  const { remote, path, now } = options;

  return {
    remote,
    local: remote.history.length,
    fetched: remote.history.length,
    unpushed: [],
    branches: [],
    stashes: [],
    deletedBranches: [],
    droppedStashes: [],
    lastFetchedAt: remote.originUrl === null ? null : now,
    placement: Placement.cases.Projects.make({}),
    main: {
      path,
      head: remote.spec.defaultBranch,
      changed: [],
      untracked: [],
      operation: null,
      threads: [],
    },
    linked: [],
    sizeBytes: sizeOf(remote.spec.folder),
  };
}

function trashedRepository(
  machine: DemoMachine,
  item: DemoMachine["trash"][number],
  now: DateTime.Utc,
): SimTrashEntry {
  const remote = createRemote(
    {
      key: `${machine.key}:trash:${item.folder}`,
      remote: item.remote,
      folder: item.folder,
      root: "projects",
      defaultBranch: item.branch,
      project: null,
      history: [item.subject],
      minutesBetweenCommits: 60,
      latestMinutesAgo: item.committedDaysAgo * 24 * 60,
      checkouts: {},
    },
    now,
  );

  const path = `${machine.roots.projects}/${item.folder}`;

  const repository = {
    ...emptyRepository({ remote, path, now }),
    sizeBytes: item.sizeMiB * mebibyte,
  };

  return {
    item: {
      id: TrashId.make(uuidFrom(machine.key, "trash", item.folder)),
      originalPath: path,
      identity: remote.identity,
      directoryName: item.folder,
      branch: item.branch,
      lastCommit: remote.history.at(-1) ?? null,
      trashedAt: DateTime.subtract(now, { days: item.trashedDaysAgo }),
      sizeBytes: repository.sizeBytes,
      worktrees: [],
    },
    repository,
  };
}

export function buildWorld(options: {
  readonly machines: ReadonlyArray<DemoMachine>;
  readonly repositories: ReadonlyArray<DemoRepository>;
  readonly now: DateTime.Utc;
}): DemoWorld {
  const { now } = options;
  const remotes = new Map<RepositoryKey, SimRemote>();
  const bySpec = new Map<string, SimRemote>();

  for (const spec of options.repositories) {
    const remote = createRemote(spec, now);

    remotes.set(remote.key, remote);
    bySpec.set(spec.key, remote);
  }

  const machines = options.machines.map((machine): SimMachine => ({
    spec: machine,
    repositories: options.repositories.flatMap((spec) => {
      const checkout = spec.checkouts[machine.key];
      const remote = bySpec.get(spec.key);

      return checkout === undefined || remote === undefined
        ? []
        : [createRepository(machine, remote, checkout, now)];
    }),
    trash: machine.trash.map((item) => trashedRepository(machine, item, now)),
    archiveFolder: machine.archive,
  }));

  return { remotes, machines };
}

export function defaultTip(repository: SimRepository): SimCommit | null {
  return repository.unpushed[0] ?? repository.remote.history[repository.local - 1] ?? null;
}

export function branchTip(repository: SimRepository, name: string): SimCommit | null {
  if (name === repository.remote.spec.defaultBranch) {
    return defaultTip(repository);
  }

  return repository.branches.find((branch) => branch.name === name)?.commits[0] ?? null;
}

export function upstreamOf(repository: SimRepository, name: string): Upstream | null {
  const { defaultBranch } = repository.remote.spec;

  if (repository.remote.originUrl === null) {
    return null;
  }

  if (name === defaultBranch) {
    return {
      name: `origin/${defaultBranch}`,
      ahead: repository.unpushed.length,
      behind: repository.fetched - repository.local,
      gone: false,
    };
  }

  const branch = repository.branches.find((candidate) => candidate.name === name);

  if (branch === undefined || branch.upstream === "None") {
    return null;
  }

  return {
    name: `origin/${name}`,
    ahead: branch.ahead,
    behind: branch.behind,
    gone: branch.upstream === "Gone",
  };
}

export function localCommitsOf(branch: SimBranch): number {
  if (branch.upstream === "Tracking") {
    return branch.ahead;
  }

  return branch.upstream === "Gone" && branch.merged ? 0 : branch.commits.length;
}

function localBranches(repository: SimRepository): Array<LocalBranch> {
  const { defaultBranch } = repository.remote.spec;
  const tip = defaultTip(repository);

  const main: LocalBranch = {
    name: defaultBranch,
    upstream: upstreamOf(repository, defaultBranch),
    tip:
      tip === null
        ? null
        : {
            ...tip,
            merged: false,
            pushed: repository.unpushed.length === 0 && repository.remote.originUrl !== null,
            localCommits: repository.unpushed.length,
          },
  };

  const others = repository.branches.map((branch): LocalBranch => {
    const head = branch.commits[0];

    const localCommits = localCommitsOf(branch);

    return {
      name: branch.name,
      upstream: upstreamOf(repository, branch.name),
      tip:
        head === undefined
          ? null
          : {
              ...head,
              merged: branch.merged,
              pushed: branch.upstream !== "None" && localCommits === 0,
              localCommits,
            },
    };
  });

  return [main, ...others].toSorted((left, right) => left.name.localeCompare(right.name));
}

export function renderCheckouts(machine: SimMachine, now: DateTime.Utc): Array<Checkout> {
  return machine.repositories.flatMap((repository) => {
    const { remote, main } = repository;
    const branches = localBranches(repository);
    const trackingTip = remote.history[repository.fetched - 1];
    const remoteTip = remote.history.at(-1);

    const github =
      remote.onGithub && remoteTip !== undefined
        ? {
            defaultBranch: remote.spec.defaultBranch,
            remoteSha: remoteTip.sha,
            trackingSha: trackingTip?.sha ?? null,
            pullRequests: remote.pullRequests,
            mergedPullRequests: remote.mergedPullRequests,
            checkedAt: minutesBefore(now, 4),
          }
        : null;

    return treesOf(repository).map((tree): Checkout => {
      const tip = branchTip(repository, tree.head);

      const git: GitStatus = {
        head: Head.cases.Branch.make({
          name: tree.head,
          upstream: upstreamOf(repository, tree.head),
        }),
        operation: tree.operation,
        lastCommit: tip,
        changed: { items: tree.changed, total: tree.changed.length },
        untracked: { items: tree.untracked, total: tree.untracked.length },
        stashes: {
          items: repository.stashes.map(({ message, sha }, index) => ({ index, message, sha })),
          total: repository.stashes.length,
        },
        branches: { items: branches, total: branches.length },
        defaultBranch: remote.originUrl === null ? null : remote.spec.defaultBranch,
        deletedBranches: {
          items: repository.deletedBranches.map(({ record }) => record),
          total: repository.deletedBranches.length,
        },
        droppedStashes: {
          items: repository.droppedStashes.map(({ record }) => record),
          total: repository.droppedStashes.length,
        },
        worktrees: treesOf(repository)
          .filter((other) => other !== tree)
          .map((other) => ({ path: other.path, branch: other.head, state: "Present" as const })),
        lastFetchedAt: repository.lastFetchedAt,
      };

      return {
        path: tree.path,
        identity: remote.identity,
        originUrl: remote.originUrl,
        directoryName: tree.path.split("/").at(-1) ?? remote.spec.folder,
        worktree:
          tree === main
            ? Worktree.cases.Main.make({})
            : Worktree.cases.Linked.make({ mainPath: main.path }),
        placement: repository.placement,
        status: CheckoutStatus.cases.Read.make({ git }),
        github,
        scannedAt: now,
      };
    });
  });
}

function iconBytes(name: DemoIconName): Buffer {
  return Buffer.from(demoIcons[name].base64, "base64");
}

function iconId(name: DemoIconName): string {
  return createHash("sha256").update(iconBytes(name)).digest("hex");
}

function projectIcon(icon: DemoProjectIcon): ProjectIcon {
  if (icon._tag === "Image") {
    return ProjectIcon.cases.Image.make({ id: iconId(icon.icon) });
  }

  if (icon._tag === "Lucide") {
    return ProjectIcon.cases.Lucide.make({ name: icon.name, color: icon.color });
  }

  return icon._tag === "Emoji"
    ? ProjectIcon.cases.Emoji.make({ emoji: icon.emoji })
    : ProjectIcon.cases.Monogram.make({ text: icon.text, color: icon.color });
}

function projectsOf(machine: SimMachine) {
  return machine.repositories.flatMap((repository) => {
    const { project } = repository.remote.spec;

    return project === null || repository.placement._tag !== "Projects"
      ? []
      : [{ repository, project, main: repository.main }];
  });
}

export function projectIconFiles(machine: SimMachine): Array<ProjectIconFile> {
  const names = new Set(
    projectsOf(machine).flatMap(({ project }) =>
      project.icon._tag === "Image" ? [project.icon.icon] : [],
    ),
  );

  return [...names].map((name) => ({
    id: iconId(name),
    mediaType: demoIcons[name].mediaType,
    base64: demoIcons[name].base64,
  }));
}

export function renderT3Code(machine: SimMachine, now: DateTime.Utc): T3CodeStatus | null {
  const { spec } = machine;

  if (!spec.t3Code) {
    return null;
  }

  const projects = projectsOf(machine).map(({ repository, project, main }) => ({
    id: uuidFrom(spec.key, "project", repository.remote.spec.key),
    title: project.title,
    path: main.path,
    icon: projectIcon(project.icon),
    autoPull: false,
    updatedAt: minutesBefore(now, 60 + (Number.parseInt(digest(main.path).slice(0, 3), 16) % 600)),
  }));

  const projectIds = new Map(
    projectsOf(machine).map(({ repository }, index) => [repository, projects[index]?.id ?? ""]),
  );

  const threads = machine.repositories.flatMap((repository) =>
    treesOf(repository).flatMap((tree) =>
      tree.threads.map((thread) => ({
        id: thread.id,
        projectId: projectIds.get(repository) ?? uuidFrom(spec.key, "project", tree.path),
        title: thread.title,
        path: tree.path,
        worktree: tree !== repository.main,
        state: thread.state,
        archived: false,
        updatedAt: thread.updatedAt,
      })),
    ),
  );

  return {
    database: `${spec.home}/.t3/userdata/state.sqlite`,
    reading: T3CodeReading.cases.Read.make({
      schema: supportedT3CodeSchema,
      projects,
      threads,
      threadCount: threads.length,
      unreadRecords: 0,
    }),
    server: {
      version: "0.9.4",
      startedAt: DateTime.subtract(now, { hours: 9 }),
      port: 3773,
    },
    providers: [
      {
        name: "Codex",
        version: "0.141.0",
        latestVersion: null,
        ready: true,
        signedIn: true,
      },
      {
        name: "Claude",
        version: "2.4.11",
        latestVersion: spec.key === "devbox" ? "2.4.13" : null,
        ready: true,
        signedIn: true,
      },
    ],
  };
}

export function renderTrash(machine: SimMachine): Array<TrashedCheckout> {
  return machine.trash.map(({ item }) => item);
}

export function machineInfo(
  spec: DemoMachine,
  now: DateTime.Utc,
  agentVersion: string,
): MachineInfo {
  return {
    hostname: spec.hostname,
    prettyName: spec.prettyName,
    platform: spec.platform,
    homeDirectory: spec.home,
    agentVersion,
    agentRuntime: "rust",
    githubCli: GithubCli.cases.Available.make({ login: demoGithubLogin }),
    system: {
      os: spec.os,
      model: spec.model,
      kind: spec.kind,
      hypervisor: spec.hypervisor,
      architecture: spec.architecture,
      cpu: spec.cpu,
      memoryBytes: spec.memoryGiB * gibibyte,
      bootedAt: DateTime.subtract(now, { days: spec.bootedDaysAgo }),
      versions: { node: spec.nodeVersion, git: spec.gitVersion },
    },
  };
}

export function sampleUsage(spec: DemoMachine, now: DateTime.Utc): SystemUsage {
  const minutes = DateTime.toEpochMillis(now) / 60_000;
  const wobble = (period: number) => Math.sin(minutes / period + spec.load);
  const load = (base: number) => Math.max(0.05, Math.round(base * 100) / 100);

  return {
    disk: { totalBytes: spec.disk.totalGiB * gibibyte, freeBytes: spec.disk.freeGiB * gibibyte },
    memoryUsedBytes: Math.round((spec.memoryUsedGiB + wobble(7) * 1.5) * gibibyte),
    loadAverage: [
      load(spec.load * (1 + 0.35 * wobble(3))),
      load(spec.load * (1 + 0.15 * wobble(11))),
      load(spec.load),
    ],
    sampledAt: now,
  };
}
