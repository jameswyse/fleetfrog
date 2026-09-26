# FleetFrog

- Run everything through pnpm. `devEngines` pins Node 26, which may differ from the `node` on `PATH`, so use `pnpm exec node` for one-off scripts.
- Effect is pinned to a 4.0 release candidate. Its APIs differ from Effect 3: RPC, HTTP, SQL, sockets, processes and the CLI live under `effect/unstable/*`. Check signatures in `node_modules/effect/src` rather than relying on memory.
- `packages/protocol` is consumed as TypeScript source and Node runs the hub and agent without a build step, so relative imports need `.ts` extensions and code must use erasable syntax only.
- `pnpm verify` runs formatting, lint, typecheck, build and unit tests. The pre-commit hook runs the staged subset.
