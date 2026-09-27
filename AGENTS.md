# FleetFrog

- Run everything through pnpm. `devEngines` pins Node 26, which may differ from the `node` on `PATH`, so use `pnpm exec node` for one-off scripts.
- `packages/protocol` is consumed as TypeScript source and Node runs the hub and agent without a build step, so relative imports need `.ts` extensions and code must use erasable syntax only.
- The hub's database and the agent's files (its config, archive records and trash) store data that was written under older schemas. When a schema change would stop existing data from decoding, such as a new required field, a renamed field or a removed variant, migrate that data as part of the change. For the hub, add a migration under `apps/hub/src/persistence/migrations` and test it by migrating a database from before the change and reading it back, as `0008_machine_archive_events.test.ts` does. On the hub, a row that fails to decode fails every query that reads it. On the agent, an archive record or trash item that fails to decode is skipped, so it disappears without an error.
- `apps/agent-rs` is the agent as a native Rust binary, and every machine runs it. `apps/agent-ts` is the original TypeScript agent, kept for now. Both speak the same protocol and share their files on the machine, so change both agents together. The Rust agent's `test:unit` checks that both read the same Git states identically. Add crates with `pnpm add crate:<name>` in `apps/agent-rs`.
- `docs/backlog.md` holds ideas for later phases. Record new ideas there instead of building them.
- `pnpm verify` runs formatting, lint, typecheck, build and unit tests. The pre-commit hook formats and lints staged files and typechecks everything.
- Write commit messages as Conventional Commits, such as `fix(web): centre rows in the Projects grid`.
- Add a changeset for each change people will notice, naming the package it changes, such as `pnpm changeset --patch @fleetfrog/web -m 'Centre rows in the Projects grid.'`. Leave `pnpm changeset version` to the user; it bumps every package together.
- During development, commit, push and deploy each finished block of work without asking first. When agent code changes, that includes updating the agent on every machine. This holds until FleetFrog has a release process for production.
- To deploy, rebuild the hub on epicdev with `docker compose up -d --build` in this checkout. To update an agent, go to `~/Projects/fleetfrog` on that machine and run `git pull --ff-only`, `pnpm install`, `pnpm --filter @fleetfrog/agent-rs build` and `apps/agent-rs/dist/fleetfrog service install`, which rewrites the systemd or launchd service and restarts the agent. Reach the Macs through `scripts/fleet` in the homelab repository. Deploy the hub before updating agents: each side ignores action kinds, tiers and commands it doesn't know, but an older hub can't read every report from a newer agent.

## Learning more about Effect

This repository uses the Effect TypeScript library, pinned to a 4.0 release candidate. Its APIs differ from Effect 3: RPC, HTTP, SQL, sockets, processes and the CLI live under `effect/unstable/*`.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` **completely**, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the guide doesn't cover, search through the source code in `node_modules/effect/src` rather than relying on memory.
