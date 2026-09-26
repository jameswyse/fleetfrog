# FleetFrog

FleetFrog is a self-hosted dashboard for the computers you develop on. An agent on each machine finds its Git repositories and reports their state to a hub, and the dashboard shows every repository against every machine: branch, uncommitted and untracked changes, stashes, commits to push or pull, and open pull requests.

From the dashboard you can also fetch, pull and clone repositories on any machine. The dashboard has no login yet, so run the hub only on a network you trust.

## Run the hub

The hub runs in Docker and serves the dashboard.

```sh
docker compose up -d --build
```

Open `http://<hub-address>:7420`. Agents connect on port `7421` over TLS using a certificate the hub generates on first start. The database and certificate live in the `fleetfrog-data` volume.

| Variable                   | Default       | Purpose                                                                            |
| -------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `FLEETFROG_DASHBOARD_PORT` | `7420`        | Dashboard and its WebSocket.                                                       |
| `FLEETFROG_AGENT_PORT`     | `7421`        | Agent pairing and connections.                                                     |
| `FLEETFROG_AGENT_TLS`      | `self-signed` | Set to `none` when a reverse proxy terminates TLS for agents.                      |
| `FLEETFROG_AGENT_URL`      | unset         | The agent URL to put in pairing strings when it differs from the dashboard's host. |
| `FLEETFROG_DATA_DIR`       | `data`        | Where the database and certificate are stored. The image uses `/data`.             |

## Add a machine

The agent is not published to npm yet, so build it from this repository on each machine. It needs Node 26 and Git, and it uses the GitHub CLI for pull requests when `gh` is signed in.

```sh
pnpm install
pnpm --filter fleetfrog build
```

In the dashboard, open **Machines**, choose **Pair a machine** and create a pairing code. Run the command it shows on the new machine, replacing `fleetfrog` with `node apps/agent/dist/bin.mjs`:

```sh
node apps/agent/dist/bin.mjs pair ffp1_…
node apps/agent/dist/bin.mjs service install
```

Pairing checks the hub's certificate against the fingerprint in the pairing string before sending anything. `service install` keeps the agent running as a systemd user service on Linux or a launchd agent on macOS. On Linux, run `loginctl enable-linger` to keep it running while you are logged out. `fleetfrog run` runs the agent in the foreground and `fleetfrog status` shows how it is paired.

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

## Develop

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the hub on port 7420 with its data in `./data` and the dashboard on Vite's port 5173, which forwards RPC to the hub. `pnpm verify` runs formatting, lint, typecheck, build and unit tests across the repository.

## Licence

MIT
