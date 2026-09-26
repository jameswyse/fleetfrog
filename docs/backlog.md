# Backlog

Ideas for after phase 2. They're captured, not planned: an entry doesn't mean it will be built, or built as described.

## Repositories and discovery

- **T3 Code discovery.** Find repositories through T3 Code's project list as well as discovery folders.
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

## Git actions

- **Automatic pull.** Pull the default branch periodically, as T3 Code does, only when the working tree is clean.
- **Scheduled fetching.** An opt-in setting. Phase 2 leaves it out because it runs network operations with the user's credentials without being asked.
- **Fast-forwarding other branches.** Pull updates only checked-out branches. Branches not checked out anywhere could be fast-forwarded too.
- **Open in editor.** Open a checkout in VS Code, Cursor, Zed or T3 Code, which registers `t3code://`. Dropped from phase 2 because links open on the viewing device, Remote-SSH needs an SSH host for each machine, and T3 Code's link format is unknown.

## Agent capabilities

Phase 2 ships only the `git` tier.

- **`scripts` tier.** Install dependencies and run repository scripts, tests and dev servers. Commands come from the repository, such as `package.json` scripts, never from the hub.
- **`files` tier.** Detect missing environment files and required keys, allowing deliberate differences between machines. Later, transfer selected environment and config files on request. Routine reports carry key names only, never values.
- **`machine` tier.** Install and update tooling such as T3 Code, Cursor, Codex, Claude, Node.js, pnpm and Rust, through agent recipes with pinned sources and verified checksums. The hub states the outcome it wants. Eventually, provision a new machine from scratch.
- **Automatic permission mode.** Use jev to decide whether to allow an action, like the automatic modes in AI coding agents.
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

- **Publishing the agent** to npm, with self-update. Machines currently build it from this repository.
- **Rust agent.** A rewrite once the idea is validated.
