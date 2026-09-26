# FleetFrog

FleetFrog is a self-hosted dashboard for the computers you develop on. An agent on each machine finds its Git repositories and reports their state to a hub, and the dashboard shows every repository against every machine: branch, uncommitted and untracked changes, stashes, commits to push or pull, and open pull requests.

The project is at phase 1. The dashboard is read-only apart from rescans, and it has no login yet, so run the hub only on a network you trust.

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

## Develop

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the hub on port 7420 with its data in `./data` and the dashboard on Vite's port 5173, which forwards RPC to the hub. `pnpm verify` runs formatting, lint, typecheck, build and unit tests across the repository.

## Licence

MIT
