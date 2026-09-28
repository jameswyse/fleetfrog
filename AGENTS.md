# FleetFrog

- Run everything through pnpm. `devEngines` pins Node 26, which may differ from the `node` on `PATH`, so use `pnpm exec node` for one-off scripts.
- `packages/protocol` is consumed as TypeScript source and Node runs the hub and agent without a build step, so relative imports need `.ts` extensions and code must use erasable syntax only.
- The hub's database and the agent's files (its config, archive records and trash) store data that was written under older schemas. When a schema change would stop existing data from decoding, such as a new required field, a renamed field or a removed variant, migrate that data as part of the change. For the hub, add a migration under `apps/hub/src/persistence/migrations` and test it by migrating a database from before the change and reading it back, as `0008_machine_archive_events.test.ts` does. On the hub, a row that fails to decode fails every query that reads it. On the agent, an archive record or trash item that fails to decode is skipped, so it disappears without an error.
- `apps/agent-rs` is the agent as a native Rust binary and the one releases ship. `apps/agent-ts` is the original TypeScript agent, kept for now. Both speak the same protocol and share their files on the machine, so change both agents together. The Rust agent's `test:unit` checks that both read the same Git states identically. Add crates with `pnpm add crate:<name>` in `apps/agent-rs`.
- To add a policy tier, add it to `Tier` in `packages/protocol` and give it a default in both agents: `Tier::allowed_by_default` in `apps/agent-rs/src/protocol.rs` and `allowedByDefault` in `apps/agent-ts/src/config/agentPolicy.ts`. Existing machines take that default when the agent first runs and record it in their policy file, so don't change a tier's default expecting existing machines to follow.
- `docs/backlog.md` holds ideas for later phases. Record new ideas there instead of building them.
- `pnpm verify` runs formatting, lint, typecheck, build and unit tests. The pre-commit hook formats and lints staged files and typechecks everything.
- Write commit messages as Conventional Commits, such as `fix(web): centre rows in the Projects grid`.
- Add a changeset for each change people will notice, naming the package it changes, such as `pnpm changeset --patch @fleetfrog/web -m 'Centre rows in the Projects grid.'`. Don't run `pnpm changeset version`: the release workflow runs it in a Version packages pull request, and merging that pull request releases the version. Leave merging it to the user. `docs/releasing.md` explains the process.
- If `AGENTS.local.md` exists, read and follow it. It holds the maintainer's instructions for their own machines and is ignored by Git.

## Learning more about Effect

This repository uses the Effect TypeScript library, pinned to a 4.0 release candidate. Its APIs differ from Effect 3: RPC, HTTP, SQL, sockets, processes and the CLI live under `effect/unstable/*`.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` **completely**, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the guide doesn't cover, search through the source code in `node_modules/effect/src` rather than relying on memory.
