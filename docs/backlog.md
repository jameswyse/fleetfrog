# Backlog

Ideas for after phase 2. They're captured, not planned: an entry doesn't mean it will be built, or built as described.

## Repositories and discovery

- **Correcting repository matches.** Merge or split repositories when matching by normalised remote or root commit gets it wrong.
- **Projects.** Group related repositories into a project, once, on the hub.
- **Shared layouts.** Define predictable relative paths such as `~/Projects/shop/api`, which machines should have each repository and which checkout is primary. Extra clones and tool-managed worktrees are tracked where they are. Phase 2's clone destination rule is a first step.
- **Filesystem watchers.** React to changes instead of polling, if polling proves too slow.
- **Cloning new projects.** Clone a repository that no machine has yet from GitHub, onto every machine.
- **More pull requests.** The GitHub reader checks only the 100 most recent open pull requests per repository.
- **GitHub read by the hub.** An optional read-only token on the hub, entered in Settings and never sent to the dashboard, so the hub queries GitHub once per repository in batched GraphQL requests instead of every agent querying each repository it has. It would list every open pull request, not only those from branches checked out somewhere, and stay current while machines sleep. Agents keep reporting the commit each checkout has fetched, and keep reading any repository the hub's token can't.

## Projects page

- **Choosing machine columns.** Hide or reorder machines on the Projects page, for fleets too wide to show every column.
- **Status-only cells.** A denser grid whose cells show only the state symbols, without branch names, to fit many machines.
- **Repository list view.** An alternative to the grid: one row per repository with a status dot for each machine, beside a detail pane. It was prototyped against the grid on 26/09/2026 and set aside while fleets are small.

## User settings

- **Colour scheme.** Choose light, dark or the system setting for the dashboard.
- **Blurring sensitive details.** Blur details that identify the user, such as email addresses and usernames, for people who stream their screen or work in public places such as planes.

## Git actions

- **Automatic pull.** Pull the default branch periodically, as T3 Code does, only when the working tree is clean. The checkout panel already says when T3 Code pulls a project itself, which such a feature should leave to T3 Code.
- **Scheduled fetching.** An opt-in setting. Phase 2 leaves it out because it runs network operations with the user's credentials without being asked.
- **Fast-forwarding other branches.** Pull updates only checked-out branches. Branches not checked out anywhere could be fast-forwarded too.
- **Open in editor.** Open a checkout in VS Code, Cursor, Zed or T3 Code. Dropped from phase 2 because links open on the viewing device and Remote-SSH needs an SSH host for each machine. T3 Code registers `t3code://`, but only as its own window's origin and a sign-in callback, not as a link that opens a folder or thread.

## Tidying with Jev

[Jev](https://typesafe.ai/) from TypeSafe AI answers typed questions about a given state with a choice and a calibrated confidence. It would run on the hub, which holds the single API key. One rule applies to every use: Jev can add caution or suggest actions, but it never removes a check. The agent's Git checks still decide whether an action is safe, because commit messages, branch names and file names come from repositories and could be written to steer the model. Requests send repository names, paths, branch names and commit subjects to TypeSafe, never file contents or environment values.

- **Tidy-up screen.** A dedicated screen listing proposed actions for repositories (delete, archive or leave) and for branches (delete or keep), already filled in from Jev's answers and ordered by its confidence. Each proposal shows the facts it rests on, such as the last commit, whether the remote is reachable and any work found only on that machine. Nothing runs until the user reviews the list and confirms it, and the agent still refuses anything its own checks don't allow.
- **Classifying ignored files.** Before a delete, decide whether each ignored file or folder that isn't a known cache, such as `data/`, `local.db` or `.cache-old`, can be rebuilt or should be kept. Anything Jev isn't confident about is shown as work that would be lost.
- **Branch triage.** Sort branches whose commits exist only on one machine, recognising names like `wip-test` or `scratch`, so likely throwaway branches are easier to review.
- **Automatic permission mode.** Decide whether to allow an action without asking, like the automatic modes in AI coding agents. It matters once FleetFrog runs actions nobody clicked, such as automatic pulls or scheduled tidying.

## Archive and trash

- **Hiding repositories.** A hub-side flag that hides a repository from the Projects page without touching any machine.
- **Archives on another disk.** Moving a checkout to an Archive folder on another filesystem needs a copy, a check and then removal of the original, instead of a rename.
- **Archives off the machine.** Move an archived checkout to TrueNAS as a tarball and a `git bundle`, stored once for the whole fleet. It needs file transfer, like the `files` tier.
- **Preserving on GitHub.** Push every branch of a checkout whose remote is gone to a new private repository, so it can be cloned again.
- **Emptying the trash automatically.** Purge trashed checkouts after a set time, such as 30 days.
- **Trash on another disk.** The trash lives in the home directory, so moving a checkout on another disk to the trash fails. A trash folder on each disk would need its own records.
- **Restoring a branch's upstream.** A branch restored from the trash comes back without its upstream, because deleting it also removes its settings.

## Agent capabilities

Agents have the `git` and `cleanup` tiers.

- **`scripts` tier.** Install dependencies and run repository scripts, tests and dev servers. Commands come from the repository, such as `package.json` scripts, never from the hub.
- **`files` tier.** Detect missing environment files and required keys, allowing deliberate differences between machines. Later, transfer selected environment and config files on request. Routine reports carry key names only, never values.
- **`machine` tier.** Install and update tooling such as T3 Code, Cursor, Codex, Claude, Node.js, pnpm and Rust, through agent recipes with pinned sources and verified checksums. The hub states the outcome it wants. Eventually, provision a new machine from scratch.
- **Signed high-risk actions.** Machine-tier actions are signed with a passkey on the user's device and checked against a key pinned at pairing, so a compromised hub can't run them.
- **End-to-end encrypted file sync.** Agents encrypt synced secrets for each other, so the hub relays values it can't read.

## Security

- **Dashboard login**, including OAuth through Authentik. Required before the hub is reachable outside a private network.
- **DNS rebinding.** The dashboard socket's `Origin` check doesn't stop DNS rebinding. A login or a `Host` allowlist would.
- **Clones checked locally.** Discovery folders and clone URLs come from the hub, so a compromised hub could clone any HTTPS or SSH repository into any non-hidden folder. Writable folders and allowed hosts kept in the agent's local policy would close that.

## Networking and platforms

- **Tailscale integration.** Many users don't have a network where their machines can reach each other, and Tailscale is common and supported by T3 Code. The Macs already reach the hub through MagicDNS, because macOS Local Network privacy blocks launchd agents from LAN addresses.
- **Windows**, maybe.
- **Faster hub-down detection.** An agent takes about 20 seconds to notice that the hub has gone.
- **Agents after logout on macOS.** launchd agents stop when the user logs out.

## Distribution

- **Agent self-update.** `fleetfrog update`, or an update the hub offers, instead of running the install script again on each machine.
- **npm packages.** The agent through npm, as a wrapper package with one package per platform, and `@fleetfrog/protocol` built to JavaScript for other clients. The service must not run a binary from inside a Node.js installation, because nvm and similar tools remove it when Node.js changes.
