# FleetFrog

- Run everything through pnpm. `devEngines` pins Node 26, which may differ from the `node` on `PATH`, so use `pnpm exec node` for one-off scripts.
- `packages/protocol` is consumed as TypeScript source and Node runs the hub and agent without a build step, so relative imports need `.ts` extensions and code must use erasable syntax only.
- `docs/backlog.md` holds ideas for later phases. Record new ideas there instead of building them.
- `pnpm verify` runs formatting, lint, typecheck, build and unit tests. The pre-commit hook formats and lints staged files and typechecks everything.
- Write commit messages as Conventional Commits, such as `fix(web): centre rows in the Projects grid`.
- During development, commit, push and deploy each finished block of work without asking first. When agent code changes, that includes updating the agent on every machine. This holds until FleetFrog has a release process for production.
- To deploy, rebuild the hub on epicdev with `docker compose up -d --build` in this checkout. To update an agent, go to `~/Projects/fleetfrog` on that machine and run `git pull --ff-only`, `pnpm install` and `pnpm --filter fleetfrog build`, then restart it with `systemctl --user restart fleetfrog` on Linux or `launchctl kickstart -k gui/$(id -u)/net.fleetfrog.agent` on macOS. Reach the Macs through `scripts/fleet` in the homelab repository.

## Learning more about Effect

This repository uses the Effect TypeScript library, pinned to a 4.0 release candidate. Its APIs differ from Effect 3: RPC, HTTP, SQL, sockets, processes and the CLI live under `effect/unstable/*`.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` **completely**, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the guide doesn't cover, search through the source code in `node_modules/effect/src` rather than relying on memory.
