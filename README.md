<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
  <img alt="FleetFrog" src="docs/images/logo-light.svg" width="304" height="64">
</picture>

FleetFrog is a self-hosted dashboard for the computers you develop on. An agent on each machine finds its Git repositories and reports their state to a hub, and the dashboard shows every repository against every machine: branch, uncommitted and untracked changes, stashes, commits to push or pull, and open pull requests.

From the dashboard you can also fetch, pull and clone repositories on any machine.

FleetFrog is in early beta, so expect rough edges and breaking changes between 0.x versions. The dashboard has no login yet, so run the hub only on a network you trust.

## Run the hub

The hub serves the dashboard and runs in Docker. Its image is published for `linux/amd64` and `linux/arm64`. Download the Compose file and start it:

```sh
curl -fsSLO https://raw.githubusercontent.com/jameswyse/fleetfrog/main/compose.yaml
docker compose up -d
```

Or run the image directly:

```sh
docker run -d --name fleetfrog-hub --restart unless-stopped \
  -p 7420:7420 -p 7421:7421 -v fleetfrog-data:/data \
  ghcr.io/jameswyse/fleetfrog-hub:latest
```

Open `http://<hub-address>:7420`. Agents connect on port `7421` over TLS using a certificate the hub generates on first start. The database and certificate live in the `fleetfrog-data` volume.

| Variable                   | Default       | Purpose                                                                            |
| -------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `FLEETFROG_DASHBOARD_PORT` | `7420`        | Dashboard and its WebSocket.                                                       |
| `FLEETFROG_AGENT_PORT`     | `7421`        | Agent pairing and connections.                                                     |
| `FLEETFROG_AGENT_TLS`      | `self-signed` | Set to `none` when a reverse proxy terminates TLS for agents.                      |
| `FLEETFROG_AGENT_URL`      | unset         | The agent URL to put in pairing strings when it differs from the dashboard's host. |
| `FLEETFROG_DATA_DIR`       | `data`        | Where the database and certificate are stored. The image uses `/data`.             |

With Compose, `FLEETFROG_VERSION` picks the image tag, such as `0.1` to take only patch releases of 0.1. It defaults to `latest`.

## Add a machine

The agent is a single binary for Linux on x86-64 or ARM, and for macOS on Apple silicon. It needs Git, and it reads pull requests through the GitHub CLI when `gh` is signed in. Install it on each machine:

```sh
curl -fsSL https://github.com/jameswyse/fleetfrog/releases/latest/download/install.sh | sh
```

The script downloads the agent for your system, checks it against the release's checksums and installs it at `~/.local/bin/fleetfrog`. Set `FLEETFROG_VERSION` to install a particular release, or `FLEETFROG_INSTALL_DIR` to install it elsewhere.

In the dashboard, open **Settings › Fleet**, choose **Pair a machine** and create a pairing code. Run the command it shows on the new machine, then start the agent as a service:

```sh
fleetfrog pair ffp1_…
fleetfrog service install
```

Pairing checks the hub's certificate against the fingerprint in the pairing string before sending anything. `service install` keeps the agent running as a systemd user service on Linux or a launchd agent on macOS. On Linux, run `loginctl enable-linger` to keep it running while you are logged out. `fleetfrog run` runs the agent in the foreground and `fleetfrog status` shows how it is paired.

## Update

Update the hub before the agents, because an older hub can't read every report from a newer agent.

```sh
docker compose pull && docker compose up -d
```

Then update the agents to the hub's version. The hub and agents share one version number, and an agent only ever updates to the version its hub runs. In the dashboard, **Settings › Fleet** marks each machine whose agent is behind and has a button that updates them all. A machine's own page updates just that one. On a machine itself, run:

```sh
fleetfrog update
```

It asks the hub for its version, lists the agent's changes since the installed version and asks before updating. Pass `--yes` to skip the question. It downloads the release, checks it against the release's checksums, replaces the agent and restarts its service. Each [release](https://github.com/jameswyse/fleetfrog/releases) lists what changed.

Agents from 0.1.0 and earlier can't update themselves, so run the install script again on those machines once. An agent built from source updates with Git instead.

## Actions

The dashboard can fetch a repository's remotes, pull (fetch, then fast-forward only) and clone a repository onto machines that don't have it. The Activity page shows running actions and 30 days of history, with Git's output for each run.

The hub never sends commands. It asks for a named action on a checkout the agent reported, and the agent decides whether to run it:

- Pull skips a checkout that has changes to tracked files, commits to push or no upstream, checking both before and after fetching.
- Clone accepts only HTTPS and SSH URLs without credentials, into a new folder inside one of the machine's discovery folders and outside hidden folders.
- Git runs without a terminal, so it fails rather than prompting, and with hooks disabled, so a pull or clone never runs scripts from the repository.

Each machine's owner decides what the hub may ask for. Git actions are allowed by default:

```sh
fleetfrog deny git    # refuse fetch, pull and clone on this machine
fleetfrog allow git   # allow them again
fleetfrog status      # show the policy and where the audit log is
```

The agent records every action it runs or refuses in a local audit log that the hub can't change: `~/.local/state/fleetfrog/actions.log` on Linux and `~/Library/Logs/FleetFrog/actions.log` on macOS. It keeps about 2 MB.

## Build from source

Building needs Git and pnpm. Install pnpm's standalone build rather than using Corepack, whose older releases can't start pnpm 12. pnpm downloads the Node.js version the repository pins.

The agent also needs a Rust toolchain, which `rustup` installs. pnpm vendors the crates it builds from, so run `pnpm install` first:

```sh
pnpm install
pnpm --filter @fleetfrog/agent-rs build
apps/agent-rs/dist/fleetfrog --version
```

A build from source never updates itself, so a release can't replace your own changes. Pull and build again to update it.

To build the hub image from a checkout instead of pulling it:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

[`apps/agent-ts`](apps/agent-ts) holds the original agent in TypeScript, which runs on Node.js and does the same job. It is kept for now, but new machines should use the Rust agent.

## Develop

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the hub on port 7420 with its data in `./data` and the dashboard on Vite's port 5173, which forwards RPC to the hub. `pnpm verify` runs formatting, lint, typecheck, build and unit tests across the repository.

To test an agent you built on a machine that already runs a released one, give it an instance name with `FLEETFROG_INSTANCE`. A named instance has its own pairing, policy, action log and service, so it can pair with a development hub while the released agent stays paired with yours:

```sh
export FLEETFROG_INSTANCE=dev
apps/agent-rs/dist/fleetfrog pair <pairing-string>
apps/agent-rs/dist/fleetfrog service install
```

The `dev` instance keeps its pairing and policy in `~/.config/fleetfrog-dev`, and its action log in a `fleetfrog-dev` folder beside the released agent's. Its service is `fleetfrog-dev.service` on Linux and `net.fleetfrog.agent-dev` on macOS. Both agents act on the same checkouts and share the machine's trash.

Describe each change people will notice in a changeset with `pnpm changeset`. [Releasing](docs/releasing.md) explains how changesets become a release.

## Licence

MIT
